//! Hybrid fixed-range profile: an exact tick profile when the range is
//! affordable, otherwise an APPROXIMATE profile built from bars.
//!
//! The choice is made up front from a cheap bar-based estimate (one
//! `history_request` page ending at the range end). The bar requests reuse the
//! existing wire `history_request` with `before_ms` paging and live in their
//! own pending/expected slots, so the chart's lazy-loading page slot is never
//! shared. Everything is tied to the [`TickCacheController`] generation: a new
//! profile, a cancel, a session reset or a symbol change bumps/clears it, and
//! a response for an older generation is ignored.
//!
//! State machine per profile request:
//!
//! ```text
//! request ─ cache covers range ─────────────────────────► tick-profile (ticks)
//!    └─ metadata + timeframe ─► ESTIMATE page ─ affordable / any failure ─► TICKS
//!    │                               └─ over budget ─► BARS (collect pages)
//!    └─ no metadata / no timeframe ───────────────────► TICKS
//! TICKS ── limit Pages | DistinctPrices (safety net) ──► BARS (whole range)
//! BARS ── paged back to `from` ────────────────────────► tick-profile (bars)
//! BARS ── history ends inside the range ─► retry a coarser timeframe (whole
//!         range, from scratch) ─► ... ─► partial tick-profile (bars)
//! ```
//!
//! A bar profile never mixes timeframes. When the broker's history for the
//! chosen timeframe ends after the range start, coarser timeframes are tried
//! (each at least twice as coarse as the last, up to `D1`, at most
//! [`MAX_HISTORY_RETRIES`]) and the first whose history reaches the range
//! start wins. When none does, the one reaching furthest back is used (the
//! finest among equals) and the result reports where its coverage starts
//! (`covered_from_ms`), so a partial profile is never shown as complete.
//!
//! Fetched bars are kept in a [`ProfileBarCache`] so an open range that is
//! refreshed every couple of seconds only fetches the bars it has not seen:
//! newer bars back to (and including) the cached newest bar, which may have
//! been forming, and older bars when the range grew backwards. A profile built
//! from cache plus increment equals one built from a full fetch; any
//! inconsistency drops the cache entry and refetches the whole range.

mod cache;
mod decision;
pub(crate) use cache::ProfileBarCache;
pub(crate) use decision::*;

use super::{
    cached_tick_size, profile_result, BridgeEvents, BridgeState, ProfileSource,
    TickCacheController, TickProfileError, TickProfileProgress, TickProfileRequest,
    TickProfileResult, COARSEST_RETRY_TIMEFRAME, MAX_ACTIVE_TICK_PAGES, MAX_CACHE_BRIDGE_PAGES,
    MAX_HISTORY_RETRIES, MAX_PROFILE_BARS, MAX_PROFILE_BAR_PAGES, MAX_PROFILE_PRICES,
};
use rust_decimal::Decimal;
use std::collections::VecDeque;
use std::sync::Arc;
use trading_core::protocol::{
    history_bars, max_estimated_profile_ticks, timeframe_seconds, ErrorCode, HistoryRequest,
    HistorySnapshot, MarketCandle,
};
use trading_core::volume_profile::{
    bar_timeframe_for_range, bar_timeframes_coarser_than, bars_overlapping_range,
    calculate_bar_profile, estimate_profile_load, partial_coverage_start, BarSeries, ProfileBudget,
};

/// The estimate page must cover the range in one request: with a margin of two
/// bars for the partial edge bars (and calendar months being longer than the
/// nominal `MN1`), the chosen timeframe may span at most this many bars.
const ESTIMATE_MAX_BARS: u64 = 998;
const ESTIMATE_EDGE_BARS: u64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BarPhase {
    Estimate,
    Collect,
}

/// Which missing part of the range a collecting job is paging in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollectStage {
    /// From the range end back to the cached newest bar (or, uncached, to the
    /// range start).
    Newest,
    /// Below the cached oldest bar, back to the range start.
    Older,
}

/// One profile's bar-history work. `generation` ties it to the controller.
#[derive(Debug)]
pub(crate) struct ProfileBarJob {
    pub(crate) generation: u64,
    pub(crate) request: TickProfileRequest,
    pub(crate) phase: BarPhase,
    pub(crate) timeframe: String,
    /// `before_ms` of the page asked for next; moves back to the oldest bar held.
    pub(crate) anchor_ms: i64,
    pub(crate) bars_per_page: u16,
    pub(crate) pages: usize,
    pub(crate) stage: CollectStage,
    /// Pages fetched in the current stage.
    pub(crate) stage_pages: usize,
    /// True while the job extends a cached series rather than a fresh walk.
    pub(crate) uses_cache: bool,
    /// Pages of the current stage, newest first; sorted once when it ends.
    pub(crate) bars: Vec<MarketCandle>,
    /// Coarser timeframes still to try, finest first, if the history of
    /// `timeframe` ends inside the range.
    pub(crate) later: VecDeque<String>,
    /// Where the history of each timeframe tried so far starts, finest first.
    pub(crate) exhausted: Vec<HistoryStart>,
    /// Bars of the walked timeframe that reaches furthest back so far.
    pub(crate) furthest: Option<(String, Vec<MarketCandle>)>,
    /// The current attempt is the last one: its result is used as it is.
    pub(crate) is_final: bool,
    /// `pages` when the current attempt began (the page bound is per attempt).
    pub(crate) attempt_first_page: usize,
}

/// A timeframe whose broker history was found to start inside the range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HistoryStart {
    pub(crate) timeframe: String,
    pub(crate) oldest_ms: i64,
}

fn bar_ms(timeframe: &str) -> i64 {
    timeframe_seconds(timeframe).map_or(1, |seconds| i64::from(seconds) * 1000)
}

/// The history start that reaches furthest back, `starts` finest first. A
/// coarser timeframe replaces the best only when it reaches back by at least
/// one of its own bars: bars open on their timeframe's grid, so a coarser one
/// opens earlier than the same history in finer bars without having more.
fn furthest_back(starts: &[HistoryStart]) -> Option<&HistoryStart> {
    starts.iter().reduce(|best, candidate| {
        if best.oldest_ms - candidate.oldest_ms >= bar_ms(&candidate.timeframe) {
            candidate
        } else {
            best
        }
    })
}

/// The timeframe the next attempt walks, with the bookkeeping it inherits.
struct CollectPlan {
    timeframe: String,
    later: VecDeque<String>,
    exhausted: Vec<HistoryStart>,
    is_final: bool,
}

impl ProfileBarJob {
    fn page_request(&self) -> HistoryRequest {
        HistoryRequest {
            symbol: self.request.wire.symbol.clone(),
            timeframe: self.timeframe.clone(),
            bars: self.bars_per_page,
            before_ms: Some(self.anchor_ms),
        }
    }

    fn progress(&self) -> TickProfileProgress {
        let bar_ms = bar_ms(&self.timeframe);
        let remaining_ms = (self.anchor_ms - self.request.wire.from_ms).max(0);
        TickProfileProgress {
            symbol: self.request.wire.symbol.clone(),
            from_ms: self.request.wire.from_ms,
            end_ms: self.request.wire.to_ms,
            completed_pages: self.pages,
            pending_pages: usize::try_from(
                remaining_ms / (bar_ms * i64::from(self.bars_per_page)) + 1,
            )
            .unwrap_or(usize::MAX),
            // Bar profiles load no ticks; this counts the tick volume the
            // loaded bars represent.
            loaded_ticks: self
                .bars
                .iter()
                .map(|bar| usize::try_from(bar.tick_volume).unwrap_or(usize::MAX))
                .fold(0usize, usize::saturating_add),
        }
    }
}

/// What a bar page did to the job.
#[derive(Debug)]
pub(crate) enum BarPageOutcome {
    /// Superseded, cancelled or from another generation: ignore silently.
    Stale,
    /// Collection continues with this page.
    Next(u64, HistoryRequest, TickProfileProgress),
    /// The history of `exhausted_timeframe` ends inside the range; the whole
    /// range is walked again with the timeframe of `request`.
    Retry {
        profile: TickProfileRequest,
        request: HistoryRequest,
        progress: TickProfileProgress,
        exhausted_timeframe: String,
        /// Open time of the oldest bar it has; `None` when it has none.
        oldest_ms: Option<i64>,
    },
    /// The estimate page arrived; `covered` is true when it reaches back to
    /// the range start (or history ends before it).
    Estimated {
        request: TickProfileRequest,
        timeframe: String,
        bars: Vec<MarketCandle>,
        covered: bool,
    },
    /// All bars of the range the broker has are held, oldest first. They start
    /// after the range start when no timeframe's history reaches it.
    Collected {
        request: TickProfileRequest,
        timeframe: String,
        bars: Vec<MarketCandle>,
        /// Bar pages fetched for this profile (0 when the cache answered).
        pages: usize,
    },
    Failed {
        request: TickProfileRequest,
        phase: BarPhase,
        message: String,
        /// Set when the EA answered the page with a correlated `error`.
        error_code: Option<ErrorCode>,
    },
}

/// Timeframe whose bars cover `range_ms` in at most `max_bars`, among the
/// timeframes the connected EA supports.
fn timeframe_for(range_ms: i64, supported: &[String], max_bars: u64) -> Option<String> {
    bar_timeframe_for_range(range_ms, supported, max_bars).map(str::to_owned)
}

fn range_ms(request: &TickProfileRequest) -> i64 {
    request.wire.to_ms - request.wire.from_ms
}

impl TickCacheController {
    /// Starts the estimate for the tick profile `begin` just prepared. `None`
    /// (no usable timeframe) means the caller loads ticks directly.
    pub(crate) fn begin_estimate(&mut self, supported: &[String]) -> Option<(u64, HistoryRequest)> {
        let request = self.active.as_ref()?.request.clone();
        let timeframe = timeframe_for(range_ms(&request), supported, ESTIMATE_MAX_BARS)?;
        let bar_ms = i64::from(timeframe_seconds(&timeframe)?) * 1000;
        let needed =
            u64::try_from(range_ms(&request) / bar_ms).unwrap_or(0) + 1 + ESTIMATE_EDGE_BARS;
        let bars_per_page = u16::try_from(needed.min(u64::from(history_bars()))).ok()?;
        let job = ProfileBarJob {
            generation: self.generation,
            anchor_ms: request.wire.to_ms,
            request,
            phase: BarPhase::Estimate,
            timeframe,
            bars_per_page,
            pages: 0,
            stage: CollectStage::Newest,
            stage_pages: 0,
            uses_cache: false,
            bars: Vec::new(),
            later: VecDeque::new(),
            exhausted: Vec::new(),
            furthest: None,
            is_final: false,
            attempt_first_page: 0,
        };
        let first = job.page_request();
        self.bar_job = Some(job);
        Some((self.generation, first))
    }

    /// Bars of a collecting profile that the cache alone can answer (a closed
    /// range inside a held series); no request is needed then. A series whose
    /// history ends inside the range answers only when no coarser timeframe
    /// is left to try.
    pub(crate) fn cached_bars_for(
        &mut self,
        request: &TickProfileRequest,
        supported: &[String],
    ) -> Option<(String, Vec<MarketCandle>)> {
        let plan = self.plan_attempts(request, supported).ok()?;
        let symbol = &request.wire.symbol;
        let (from_ms, to_ms) = (request.wire.from_ms, request.wire.to_ms);
        let series = self.bar_cache.get(symbol, &plan.timeframe)?;
        if !series.coverage(from_ms, to_ms).is_complete() {
            return None;
        }
        let bars = series.covering(from_ms, to_ms).to_vec();
        if !plan.is_final && partial_coverage_start(&bars, from_ms).is_some() {
            return None;
        }
        self.bar_cache.mark_used(symbol, &plan.timeframe);
        Some((plan.timeframe, bars))
    }

    /// Chooses the timeframe to walk first: the finest one that fits the bar
    /// bound and is not already known to end inside the range. When all of
    /// them are, the one reaching furthest back is walked as the last attempt.
    fn plan_attempts(
        &self,
        request: &TickProfileRequest,
        supported: &[String],
    ) -> Result<CollectPlan, String> {
        let base =
            timeframe_for(range_ms(request), supported, MAX_PROFILE_BARS).ok_or_else(|| {
                "Profile range is too long to approximate from bars; select a shorter range"
                    .to_owned()
            })?;
        let mut candidates: VecDeque<String> = bar_timeframes_coarser_than(
            &base,
            supported,
            COARSEST_RETRY_TIMEFRAME,
            MAX_HISTORY_RETRIES,
        )
        .into_iter()
        .map(str::to_owned)
        .collect();
        candidates.push_front(base);
        self.next_attempt(request, candidates, Vec::new())
            .ok_or_else(|| "Profile range has no bar history".to_owned())
    }

    /// Takes the next candidate that is not known to end inside the range
    /// (known ones join `exhausted`). With none left, the furthest-reaching
    /// known one becomes the final attempt; `None` when nothing was found.
    fn next_attempt(
        &self,
        request: &TickProfileRequest,
        mut candidates: VecDeque<String>,
        mut exhausted: Vec<HistoryStart>,
    ) -> Option<CollectPlan> {
        let (symbol, from_ms) = (&request.wire.symbol, request.wire.from_ms);
        while let Some(timeframe) = candidates.pop_front() {
            match self
                .bar_cache
                .history_starting_after(symbol, &timeframe, from_ms)
            {
                Some(oldest_ms) => exhausted.push(HistoryStart {
                    timeframe,
                    oldest_ms,
                }),
                None => {
                    return Some(CollectPlan {
                        timeframe,
                        later: candidates,
                        exhausted,
                        is_final: false,
                    })
                }
            }
        }
        let timeframe = furthest_back(&exhausted)?.timeframe.clone();
        Some(CollectPlan {
            timeframe,
            later: VecDeque::new(),
            exhausted,
            is_final: true,
        })
    }

    /// Where an attempt on `timeframe` starts walking: a cached series
    /// narrows it to what the series is missing.
    fn attempt_start(
        &self,
        request: &TickProfileRequest,
        timeframe: &str,
    ) -> (CollectStage, i64, bool) {
        let (from_ms, to_ms) = (request.wire.from_ms, request.wire.to_ms);
        match self.bar_cache.get(&request.wire.symbol, timeframe) {
            None => (CollectStage::Newest, to_ms, false),
            Some(series) => {
                let coverage = series.coverage(from_ms, to_ms);
                if coverage.extend_older && !coverage.refresh_newest {
                    (CollectStage::Older, series.oldest_ms(), true)
                } else {
                    (CollectStage::Newest, to_ms, true)
                }
            }
        }
    }

    /// Starts paging bars for the whole range, discarding any tick state (a
    /// profile never mixes ticks and bars). A cached series for the same
    /// symbol and timeframe narrows the walk to what it is missing.
    pub(crate) fn begin_collect(
        &mut self,
        request: TickProfileRequest,
        supported: &[String],
    ) -> Result<(u64, HistoryRequest), String> {
        self.active = None;
        self.bar_job = None;
        let plan = self.plan_attempts(&request, supported)?;
        let (stage, anchor_ms, uses_cache) = self.attempt_start(&request, &plan.timeframe);
        let job = ProfileBarJob {
            generation: self.generation,
            anchor_ms,
            request,
            phase: BarPhase::Collect,
            timeframe: plan.timeframe,
            bars_per_page: history_bars(),
            pages: 0,
            stage,
            stage_pages: 0,
            uses_cache,
            bars: Vec::new(),
            later: plan.later,
            exhausted: plan.exhausted,
            furthest: None,
            is_final: plan.is_final,
            attempt_first_page: 0,
        };
        let first = job.page_request();
        self.bar_job = Some(job);
        Ok((self.generation, first))
    }

    /// True while `generation` still owns the bar job (a send guard).
    pub(crate) fn bar_request_is_current(&self, generation: u64) -> bool {
        self.generation == generation
            && self
                .bar_job
                .as_ref()
                .is_some_and(|job| job.generation == generation)
    }

    /// Drops a bar job that belongs to a symbol other than `symbol`.
    /// Cached bars of other symbols go with it.
    pub(crate) fn drop_bar_job_for_other_symbol(&mut self, symbol: Option<&str>) -> bool {
        self.bar_cache.retain_symbol(symbol);
        let stale = self
            .bar_job
            .as_ref()
            .is_some_and(|job| Some(job.request.wire.symbol.as_str()) != symbol);
        if stale {
            self.bar_job = None;
        }
        stale
    }

    pub(crate) fn finish_bars(&mut self) {
        self.bar_job = None;
    }

    pub(crate) fn bar_job_phase(&self) -> Option<BarPhase> {
        self.bar_job.as_ref().map(|job| job.phase)
    }

    pub(crate) fn bar_job_request(&self) -> Option<TickProfileRequest> {
        self.bar_job.as_ref().map(|job| job.request.clone())
    }

    /// Applies one history page to the bar job of `generation`.
    pub(crate) fn ingest_bar_page(
        &mut self,
        generation: u64,
        snapshot: HistorySnapshot,
    ) -> BarPageOutcome {
        if !self.bar_request_is_current(generation) {
            return BarPageOutcome::Stale;
        }
        let mut job = self.bar_job.take().expect("checked by the guard");
        let fail = |job: &ProfileBarJob, message: &str| BarPageOutcome::Failed {
            request: job.request.clone(),
            phase: job.phase,
            message: message.to_owned(),
            error_code: None,
        };
        if snapshot.validate(&job.page_request()).is_err() {
            return fail(&job, "Bar history for the profile was invalid");
        }
        // Strictly older than the anchor is the page contract; a peer that
        // ignores `before_ms` answers the newest bars and would loop forever.
        if snapshot
            .candles
            .iter()
            .any(|candle| candle.time_ms >= job.anchor_ms)
        {
            return fail(
                &job,
                "Bar history for the profile was not older than requested",
            );
        }
        let oldest_ms = snapshot.candles.first().map(|candle| candle.time_ms);
        // History ran out (or the page is empty): nothing older exists.
        let history_ended = oldest_ms.is_none() || !snapshot.complete;
        let reached_start =
            history_ended || oldest_ms.is_some_and(|oldest| oldest <= job.request.wire.from_ms);
        job.pages += 1;
        job.stage_pages += 1;
        job.bars.extend(snapshot.candles);
        if job.phase == BarPhase::Estimate {
            sort_job_bars(&mut job);
            return BarPageOutcome::Estimated {
                request: job.request,
                timeframe: job.timeframe,
                bars: job.bars,
                covered: reached_start,
            };
        }
        let step = self.collect_step(&job, oldest_ms, reached_start);
        if matches!(
            step,
            CollectStep::Continue | CollectStep::DropCacheAndContinue
        ) {
            // Not reaching the start implies a non-empty page.
            job.anchor_ms = oldest_ms.expect("a page that continues the walk has bars");
        }
        let outcome = self.apply_collect_step(&mut job, step, history_ended);
        match outcome {
            CollectOutcome::Done(bars) => self.finish_attempt(job, bars),
            CollectOutcome::More => {
                if job.pages - job.attempt_first_page >= MAX_PROFILE_BAR_PAGES {
                    return fail(
                        &job,
                        &format!(
                            "Profile range needs more than {MAX_PROFILE_BAR_PAGES} bar pages; select a shorter range"
                        ),
                    );
                }
                let next = BarPageOutcome::Next(generation, job.page_request(), job.progress());
                self.bar_job = Some(job);
                next
            }
        }
    }

    /// An attempt walked the whole range. Its bars are the result when they
    /// reach the range start (or this was the last attempt); otherwise the
    /// history of its timeframe ends inside the range, which is remembered,
    /// and the next coarser timeframe is walked from scratch.
    fn finish_attempt(
        &mut self,
        mut job: ProfileBarJob,
        bars: Vec<MarketCandle>,
    ) -> BarPageOutcome {
        let (symbol, from_ms) = (job.request.wire.symbol.clone(), job.request.wire.from_ms);
        let reaches_start = !bars.is_empty() && partial_coverage_start(&bars, from_ms).is_none();
        if job.is_final || reaches_start {
            return collected(job, bars);
        }
        let oldest_ms = bars.first().map(|bar| bar.time_ms);
        let exhausted_timeframe = job.timeframe.clone();
        if let Some(oldest_ms) = oldest_ms {
            self.bar_cache
                .remember_history_start(&symbol, &job.timeframe, oldest_ms);
            job.exhausted.push(HistoryStart {
                timeframe: job.timeframe.clone(),
                oldest_ms,
            });
            let best = furthest_back(&job.exhausted).map(|best| best.timeframe.clone());
            job.furthest = if best.as_deref() == Some(job.timeframe.as_str()) {
                Some((job.timeframe.clone(), bars))
            } else {
                job.furthest
                    .take()
                    .filter(|(held, _)| Some(held) == best.as_ref())
            };
        }
        let plan = self.next_attempt(
            &job.request,
            std::mem::take(&mut job.later),
            std::mem::take(&mut job.exhausted),
        );
        let Some(plan) = plan else {
            // No timeframe has any bar in the range: report it empty.
            return collected(job, Vec::new());
        };
        job.later = plan.later;
        job.exhausted = plan.exhausted;
        job.is_final = plan.is_final;
        if let Some((held, held_bars)) = job.furthest.take() {
            if plan.is_final && held == plan.timeframe {
                job.timeframe = held;
                return collected(job, held_bars);
            }
            job.furthest = Some((held, held_bars));
        }
        let (stage, anchor_ms, uses_cache) = self.attempt_start(&job.request, &plan.timeframe);
        job.timeframe = plan.timeframe;
        job.stage = stage;
        job.anchor_ms = anchor_ms;
        job.uses_cache = uses_cache;
        job.stage_pages = 0;
        job.attempt_first_page = job.pages;
        job.bars.clear();
        let outcome = BarPageOutcome::Retry {
            profile: job.request.clone(),
            request: job.page_request(),
            progress: job.progress(),
            exhausted_timeframe,
            oldest_ms,
        };
        self.bar_job = Some(job);
        outcome
    }

    /// What the page just ingested means for a collecting job.
    fn collect_step(
        &self,
        job: &ProfileBarJob,
        oldest_ms: Option<i64>,
        reached_start: bool,
    ) -> CollectStep {
        if !job.uses_cache {
            return if reached_start {
                CollectStep::FinishFresh
            } else {
                CollectStep::Continue
            };
        }
        let Some(series) = self.bar_cache.get(&job.request.wire.symbol, &job.timeframe) else {
            return CollectStep::Restart;
        };
        match job.stage {
            CollectStage::Older if reached_start => CollectStep::Merge,
            CollectStage::Older => CollectStep::Continue,
            CollectStage::Newest
                if oldest_ms.is_some_and(|oldest| oldest <= series.newest_ms()) =>
            {
                CollectStep::Merge
            }
            // The walk ended without touching the held series: disjoint.
            CollectStage::Newest if reached_start => CollectStep::DropCacheAndFinish,
            // Too long a pause to bridge cheaply: the pages held so far are a
            // valid prefix of a fresh walk, so keep going without the cache.
            CollectStage::Newest if job.stage_pages >= MAX_CACHE_BRIDGE_PAGES => {
                CollectStep::DropCacheAndContinue
            }
            CollectStage::Newest => CollectStep::Continue,
        }
    }

    fn apply_collect_step(
        &mut self,
        job: &mut ProfileBarJob,
        step: CollectStep,
        history_ended: bool,
    ) -> CollectOutcome {
        let symbol = job.request.wire.symbol.clone();
        match step {
            CollectStep::Continue => CollectOutcome::More,
            CollectStep::DropCacheAndContinue => {
                self.bar_cache.remove(&symbol, &job.timeframe);
                job.uses_cache = false;
                CollectOutcome::More
            }
            CollectStep::Restart => self.restart_fresh(job),
            CollectStep::DropCacheAndFinish => {
                self.bar_cache.remove(&symbol, &job.timeframe);
                job.uses_cache = false;
                self.finish_fresh(job, history_ended)
            }
            CollectStep::FinishFresh => self.finish_fresh(job, history_ended),
            CollectStep::Merge => self.merge_into_cache(job, history_ended),
        }
    }

    /// Abandons the cache and walks the whole range again from its end.
    fn restart_fresh(&mut self, job: &mut ProfileBarJob) -> CollectOutcome {
        self.bar_cache
            .remove(&job.request.wire.symbol, &job.timeframe);
        self.bar_cache
            .forget_history_start(&job.request.wire.symbol, &job.timeframe);
        job.uses_cache = false;
        job.stage = CollectStage::Newest;
        job.anchor_ms = job.request.wire.to_ms;
        job.pages = 0;
        job.stage_pages = 0;
        job.bars.clear();
        CollectOutcome::More
    }

    /// An uncached walk reached the range start: its bars become the series.
    fn finish_fresh(&mut self, job: &mut ProfileBarJob, history_ended: bool) -> CollectOutcome {
        sort_job_bars(job);
        let bars = std::mem::take(&mut job.bars);
        let Ok(series) = BarSeries::new(&job.timeframe, bars, history_ended) else {
            // Nothing usable (an empty page): report no bars, keep no state.
            return CollectOutcome::Done(Vec::new());
        };
        let window = series
            .covering(job.request.wire.from_ms, job.request.wire.to_ms)
            .to_vec();
        self.bar_cache.store(&job.request.wire.symbol, series);
        CollectOutcome::Done(window)
    }

    /// Joins the stage's pages to the cached series; any inconsistency drops
    /// the entry and restarts with a full fetch.
    fn merge_into_cache(&mut self, job: &mut ProfileBarJob, history_ended: bool) -> CollectOutcome {
        sort_job_bars(job);
        let fetched = std::mem::take(&mut job.bars);
        let (symbol, from_ms, to_ms) = (
            job.request.wire.symbol.clone(),
            job.request.wire.from_ms,
            job.request.wire.to_ms,
        );
        let Some(series) = self.bar_cache.get_mut(&symbol, &job.timeframe) else {
            return self.restart_fresh(job);
        };
        let merged = match job.stage {
            CollectStage::Newest => series.merge_newer(fetched, history_ended).is_ok(),
            // An empty older page only says history starts here.
            CollectStage::Older if fetched.is_empty() => {
                series.mark_history_start_reached();
                true
            }
            CollectStage::Older => series.merge_older(fetched, history_ended).is_ok(),
        };
        if !merged {
            return self.restart_fresh(job);
        }
        if job.stage == CollectStage::Newest && series.coverage(from_ms, to_ms).extend_older {
            job.stage = CollectStage::Older;
            job.stage_pages = 0;
            job.anchor_ms = series.oldest_ms();
            return CollectOutcome::More;
        }
        let window = series.covering(from_ms, to_ms).to_vec();
        self.bar_cache.mark_used(&symbol, &job.timeframe);
        if let Some(series) = self.bar_cache.get_mut(&symbol, &job.timeframe) {
            series.truncate_oldest(usize::try_from(MAX_PROFILE_BARS).unwrap_or(usize::MAX));
        }
        CollectOutcome::Done(window)
    }
}

fn collected(job: ProfileBarJob, bars: Vec<MarketCandle>) -> BarPageOutcome {
    BarPageOutcome::Collected {
        pages: job.pages,
        request: job.request,
        timeframe: job.timeframe,
        bars,
    }
}

/// What a collected page asks of the job next.
#[derive(Debug, Clone, Copy)]
enum CollectStep {
    Continue,
    /// The stage's pages are complete: join them to the cached series.
    Merge,
    /// The cache is unusable: discard it and walk the whole range again.
    Restart,
    DropCacheAndContinue,
    DropCacheAndFinish,
    FinishFresh,
}

enum CollectOutcome {
    More,
    Done(Vec<MarketCandle>),
}

/// Pages arrive newest first; order the stage's bars oldest first.
fn sort_job_bars(job: &mut ProfileBarJob) {
    job.bars.sort_by_key(|bar| bar.time_ms);
    job.bars.dedup_by_key(|bar| bar.time_ms);
}

/// Tick size and point of `symbol` from the local symbol mirror; the estimate
/// and the bar grid both need them, so without them ticks are used.
fn symbol_grid(state: &BridgeState, symbol: &str) -> Option<(Decimal, Decimal)> {
    let tick_size = cached_tick_size(state, symbol)?;
    let point = state
        .symbol_cache
        .lock()
        .expect("symbol cache mutex poisoned")
        .cache
        .get(symbol)
        .and_then(|entry| entry.point_size.parse::<Decimal>().ok())
        .filter(|point| *point >= Decimal::ZERO)?;
    Some((tick_size, point))
}

/// True when the symbol metadata the estimate needs is cached.
pub(crate) fn can_estimate(state: &BridgeState, symbol: &str) -> bool {
    symbol_grid(state, symbol).is_some()
}

/// Decides the source of an estimated range. Any failure to estimate chooses
/// ticks: the tick path never paints partial data, so it is the safe default.
/// The decision carries the reason for the log line.
pub(crate) fn choose_source(
    state: &BridgeState,
    request: &TickProfileRequest,
    timeframe: &str,
    bars: &[MarketCandle],
    covered: bool,
) -> SourceDecision {
    let ticks = |reason| SourceDecision::ticks(reason).with_estimate(timeframe, bars.len());
    if !covered {
        return ticks(SourceReason::EstimateIncomplete);
    }
    let Some((tick_size, point)) = symbol_grid(state, &request.wire.symbol) else {
        return ticks(SourceReason::NoSymbolMetadata);
    };
    let Ok(in_range) =
        bars_overlapping_range(bars, timeframe, request.wire.from_ms, request.wire.to_ms)
    else {
        return ticks(SourceReason::EstimateInvalid);
    };
    let Ok(estimate) = estimate_profile_load(&in_range, tick_size, point) else {
        return ticks(SourceReason::EstimateInvalid);
    };
    let budget = ProfileBudget {
        max_ticks: max_estimated_profile_ticks(),
        max_distinct_prices: MAX_PROFILE_PRICES as u64,
        max_pages: MAX_ACTIVE_TICK_PAGES as u64,
        ticks_per_page: u64::from(
            state
                .transfer_limits
                .lock()
                .expect("transfer limits mutex poisoned")
                .max_ticks_per_page,
        ),
    };
    // A zero page size is unaffordable (as in `exceeds`): report it as an
    // unbounded page count so the figures reach the same verdict.
    let pages = estimate
        .ticks
        .checked_div(budget.ticks_per_page)
        .map_or(u64::MAX, |_| estimate.ticks.div_ceil(budget.ticks_per_page));
    SourceDecision::from_load(LoadFigures {
        ticks: estimate.ticks,
        max_ticks: budget.max_ticks,
        prices: estimate.distinct_prices,
        max_prices: budget.max_distinct_prices,
        pages,
        max_pages: budget.max_pages,
    })
    .with_estimate(timeframe, bars.len())
}

/// Timeframe an approximate profile of `request` would page, for the log.
pub(crate) fn collect_timeframe(
    state: &BridgeState,
    request: &TickProfileRequest,
) -> Option<String> {
    let supported = state
        .status
        .lock()
        .expect("bridge status mutex poisoned")
        .supported_timeframes
        .clone();
    timeframe_for(range_ms(request), &supported, MAX_PROFILE_BARS)
}

/// Logs the decision for `request`; bars also name the timeframe they will page.
pub(crate) fn log_decision(
    state: &BridgeState,
    request: &TickProfileRequest,
    decision: &SourceDecision,
) {
    let collect = (decision.source == ProfileSource::Bars)
        .then(|| collect_timeframe(state, request))
        .flatten();
    log_info(&decision_line(request, decision, collect.as_deref()));
}

/// Logs where a partial profile's coverage starts; nothing when it is whole.
pub(crate) fn log_partial_history(
    request: &TickProfileRequest,
    timeframe: &str,
    bars: &[MarketCandle],
) {
    if let Some(covered_from_ms) = partial_coverage_start(bars, request.wire.from_ms) {
        log_info(&partial_history_line(request, timeframe, covered_from_ms));
    }
}

/// Builds the approximate profile event payload from the collected bars.
pub(crate) fn build_bar_profile(
    state: &BridgeState,
    request: &TickProfileRequest,
    timeframe: &str,
    bars: &[MarketCandle],
) -> Result<TickProfileResult, &'static str> {
    let tick_size = cached_tick_size(state, &request.wire.symbol)
        .ok_or("Bar profile needs the symbol tick size; reconnect or reselect the symbol")?;
    let in_range =
        bars_overlapping_range(bars, timeframe, request.wire.from_ms, request.wire.to_ms)?;
    let calculated = calculate_bar_profile(&in_range, &request.config(tick_size))?;
    let mut result = profile_result(
        request.wire.symbol.clone(),
        request.wire.from_ms,
        request.wire.to_ms,
        true,
        calculated,
    );
    result.source = ProfileSource::Bars;
    result.bar_timeframe = Some(timeframe.to_owned());
    result.covered_from_ms = partial_coverage_start(bars, request.wire.from_ms);
    Ok(result)
}

/// Builds the approximate profile and emits it, or the error that prevented it.
pub(crate) fn emit_bar_profile(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    request: &TickProfileRequest,
    timeframe: &str,
    bars: &[MarketCandle],
) {
    match build_bar_profile(state, request, timeframe, bars) {
        Ok(result) => super::bridge_emit(events, "tick-profile", result),
        Err(error) => emit_profile_error(events, request, error.to_owned()),
    }
}

pub(crate) fn emit_profile_error(
    events: &Arc<dyn BridgeEvents>,
    request: &TickProfileRequest,
    message: String,
) {
    super::bridge_emit(
        events,
        "tick-profile-error",
        TickProfileError {
            symbol: request.wire.symbol.clone(),
            from_ms: request.wire.from_ms,
            end_ms: request.wire.to_ms,
            message,
        },
    );
}

/// Queues the first bar page of a whole-range approximate profile, or ends the
/// profile with an error when no timeframe can cover the range. The caller
/// holds the session gate.
pub(crate) fn start_bar_collect(
    events: &Arc<dyn BridgeEvents>,
    state: &BridgeState,
    request: TickProfileRequest,
) {
    let supported = state
        .status
        .lock()
        .expect("bridge status mutex poisoned")
        .supported_timeframes
        .clone();
    let started = {
        let mut controller = state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned");
        // A closed range inside the cached series needs no request at all.
        controller.active = None;
        controller.bar_job = None;
        if let Some((timeframe, bars)) = controller.cached_bars_for(&request, &supported) {
            drop(controller);
            log_info(&cache_line(&request, ProfileSource::Bars));
            log_partial_history(&request, &timeframe, &bars);
            emit_bar_profile(events, state, &request, &timeframe, &bars);
            return;
        }
        controller.begin_collect(request.clone(), &supported)
    };
    match started {
        Ok(pending) => {
            *state
                .pending_profile_bars
                .lock()
                .expect("profile bars mutex poisoned") = Some(pending);
        }
        Err(message) => {
            state
                .tick_controller
                .lock()
                .expect("tick controller mutex poisoned")
                .finish_bars();
            emit_profile_error(events, &request, message);
        }
    }
}

/// Continues with the exact tick load that `begin` prepared (estimate said
/// affordable, or could not be made).
pub(crate) fn resume_tick_load(state: &BridgeState, generation: u64) {
    let request = {
        let controller = state
            .tick_controller
            .lock()
            .expect("tick controller mutex poisoned");
        if controller.generation != generation {
            return;
        }
        controller
            .active
            .as_ref()
            .map(|active| active.request.clone())
    };
    if let Some(request) = request {
        *state
            .pending_tick_profile
            .lock()
            .expect("tick profile mutex poisoned") = Some(request);
    }
}

/// Clears both profile bar slots; used wherever the tick profile slots are.
pub(crate) fn clear_profile_bar_slots(state: &BridgeState) {
    *state
        .pending_profile_bars
        .lock()
        .expect("profile bars mutex poisoned") = None;
    *state
        .expected_profile_bars
        .lock()
        .expect("profile bars mutex poisoned") = None;
}
