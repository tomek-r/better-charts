mod calculation;
pub(crate) use calculation::*;

use super::{
    ActiveTickProfile, CachedTickRange, CompactTickProfile, TickHistorySnapshot, TickPageResult,
    TickProfileCancelledView, TickProfileProgress, TickProfileRequest, MAX_ACTIVE_TICK_PAGES,
    MAX_PROFILE_PRICES, MAX_RETAINED_PROFILE_TICKS,
};
use std::collections::VecDeque;
use trading_core::protocol::TickPriceHistorySnapshot;
use trading_core::volume_profile::{FixedRangeProfileAccumulator, Tick as ProfileTick};

#[derive(Debug, Default)]
pub(crate) struct TickCacheController {
    // FIFO order makes eviction deterministic.  Entries never overlap for a
    // symbol, so cached pages cannot duplicate ticks in an aggregate.
    pub(crate) entries: VecDeque<CachedTickRange>,
    pub(crate) price_entries: VecDeque<TickPriceHistorySnapshot>,
    pub(crate) active: Option<ActiveTickProfile>,
    pub(crate) generation: u64,
}

impl TickCacheController {
    #[cfg(test)]
    pub(crate) fn cached_tick_count(&self, symbol: &str) -> usize {
        self.entries
            .iter()
            .filter(|item| item.snapshot.symbol == symbol)
            .map(|item| item.snapshot.ticks.len())
            .sum()
    }
    pub(crate) fn begin(
        &mut self,
        request: TickProfileRequest,
    ) -> Vec<trading_core::volume_profile::TickRange> {
        self.generation += 1;
        let range = trading_core::volume_profile::TickRange {
            start_ms: request.wire.from_ms,
            end_ms: request.wire.to_ms,
        };
        let mut cached = self
            .entries
            .iter()
            .filter(|item| {
                item.snapshot.symbol == request.wire.symbol
                    && item.range.start_ms < range.end_ms
                    && range.start_ms < item.range.end_ms
            })
            .map(|item| {
                let clipped_range = trading_core::volume_profile::TickRange {
                    start_ms: item.range.start_ms.max(range.start_ms),
                    end_ms: item.range.end_ms.min(range.end_ms),
                };
                let start = item
                    .snapshot
                    .ticks
                    .partition_point(|tick| tick.time_ms < clipped_range.start_ms);
                let end = item
                    .snapshot
                    .ticks
                    .partition_point(|tick| tick.time_ms < clipped_range.end_ms);
                let snapshot = TickHistorySnapshot {
                    request_id: item.snapshot.request_id.clone(),
                    symbol: item.snapshot.symbol.clone(),
                    from_ms: clipped_range.start_ms,
                    to_ms: clipped_range.end_ms,
                    tick_size: item.snapshot.tick_size.clone(),
                    complete: item.snapshot.complete,
                    ticks: item.snapshot.ticks[start..end].to_vec(),
                };
                CachedTickRange {
                    range: clipped_range,
                    snapshot,
                }
            })
            .collect::<Vec<_>>();
        // A profile must use one tick size.  Falling back to the wire is safer
        // than constructing an aggregate from old, incompatible cache pages.
        if cached.first().is_some_and(|first| {
            cached
                .iter()
                .any(|item| item.snapshot.tick_size != first.snapshot.tick_size)
        }) {
            cached.clear();
        }
        let mut covered = cached.iter().map(|item| item.range).collect::<Vec<_>>();
        covered.sort_unstable_by_key(|range| range.start_ms);
        let gaps = trading_core::volume_profile::plan_tick_ranges(range, &covered);
        let loaded_ticks = cached.iter().map(|item| item.snapshot.ticks.len()).sum();
        let parts = cached.into_iter().map(|item| item.snapshot).collect();
        self.active = Some(ActiveTickProfile {
            generation: self.generation,
            request,
            gaps: gaps.clone(),
            parts,
            compact: None,
            incomplete: false,
            completed_pages: 0,
            loaded_ticks,
        });
        // Price summaries can be reused only as whole pages: clipping their
        // time boundaries would invent the distribution inside a page.
        let summaries = self
            .price_entries
            .iter()
            .filter(|page| {
                page.symbol
                    == self
                        .active
                        .as_ref()
                        .expect("initialized")
                        .request
                        .wire
                        .symbol
                    && range.start_ms <= page.from_ms
                    && page.to_ms <= range.end_ms
                    // Raw cache ranges are disjoint, so ends increase with starts.
                    && !covered.get(covered.partition_point(|raw| raw.end_ms <= page.from_ms))
                        .is_some_and(|raw| raw.start_ms < page.to_ms)
            })
            .collect::<Vec<_>>();
        if summaries.is_empty() {
            return gaps;
        }
        let active = self.active.as_mut().expect("initialized");
        let mut compact = CompactTickProfile {
            tick_size: summaries[0].tick_size.clone(),
            complete: false,
            counts: FixedRangeProfileAccumulator::new(MAX_PROFILE_PRICES),
        };
        let merge = (|| {
            for part in &active.parts {
                Self::accumulate_page(&mut compact, part)?;
            }
            for page in &summaries {
                Self::accumulate_summary(&mut compact, page)?;
            }
            Ok::<_, &'static str>(())
        })();
        if merge.is_err() {
            return gaps;
        }
        let mut all_covered = covered;
        all_covered.extend(
            summaries
                .iter()
                .map(|page| trading_core::volume_profile::TickRange {
                    start_ms: page.from_ms,
                    end_ms: page.to_ms,
                }),
        );
        active.gaps = trading_core::volume_profile::plan_tick_ranges(range, &all_covered);
        active.loaded_ticks += summaries
            .iter()
            .map(|page| page.loaded_ticks as usize)
            .sum::<usize>();
        active.parts.clear();
        active.compact = Some(compact);
        active.gaps.clone()
    }
    pub(crate) fn cancel(&mut self) {
        self.generation += 1;
        self.active = None;
    }

    pub(crate) fn clear(&mut self) {
        self.cancel();
        self.entries.clear();
        self.price_entries.clear();
    }
    pub(crate) fn next_page(&self) -> Option<(u64, TickProfileRequest)> {
        let active = self.active.as_ref()?;
        let range = active.gaps.first().copied()?;
        let page = Self::page_request(active, range);
        Some((active.generation, page))
    }

    fn page_request(
        active: &ActiveTickProfile,
        range: trading_core::volume_profile::TickRange,
    ) -> TickProfileRequest {
        let mut page = active.request.clone();
        page.wire.from_ms = range.start_ms;
        page.wire.to_ms = range.end_ms;
        page
    }

    pub(crate) fn progress(&self) -> Option<TickProfileProgress> {
        let active = self.active.as_ref()?;
        Some(TickProfileProgress {
            symbol: active.request.wire.symbol.clone(),
            from_ms: active.request.wire.from_ms,
            end_ms: active.request.wire.to_ms,
            completed_pages: active.completed_pages,
            pending_pages: active.gaps.len(),
            loaded_ticks: active.loaded_ticks,
        })
    }

    pub(crate) fn cancelled_view(&self) -> Option<TickProfileCancelledView> {
        let active = self.active.as_ref()?;
        Some(TickProfileCancelledView {
            symbol: active.request.wire.symbol.clone(),
            from_ms: active.request.wire.from_ms,
            end_ms: active.request.wire.to_ms,
        })
    }

    fn aggregate(
        request: &TickProfileRequest,
        parts: &[TickHistorySnapshot],
        complete: bool,
    ) -> Result<TickHistorySnapshot, &'static str> {
        let mut ordered = parts.to_vec();
        ordered.sort_by_key(|part| part.from_ms);
        let Some(first) = ordered.first() else {
            return Err("tick profile has no pages");
        };
        let tick_size = first.tick_size.clone();
        if ordered.iter().any(|part| part.tick_size != tick_size) {
            return Err("tick size changed during tick profile");
        }
        let ticks = ordered.into_iter().flat_map(|part| part.ticks).collect();
        Ok(TickHistorySnapshot {
            request_id: "aggregated-tick-profile".into(),
            symbol: request.wire.symbol.clone(),
            from_ms: request.wire.from_ms,
            to_ms: request.wire.to_ms,
            tick_size,
            complete,
            ticks,
        })
    }

    pub(crate) fn ingest(
        &mut self,
        generation: u64,
        mut snapshot: TickHistorySnapshot,
    ) -> TickPageResult {
        let Some(active) = self.active.as_ref() else {
            return TickPageResult::Stale;
        };
        if active.generation != generation {
            return TickPageResult::Stale;
        }
        let range = trading_core::volume_profile::TickRange {
            start_ms: snapshot.from_ms,
            end_ms: snapshot.to_ms,
        };
        if snapshot.symbol != active.request.wire.symbol
            || range.start_ms < active.request.wire.from_ms
            || range.end_ms > active.request.wire.to_ms
            || active.gaps.first().copied() != Some(range)
        {
            return TickPageResult::Stale;
        }
        let page_request = Self::page_request(active, range).wire;
        if snapshot.validate(&page_request).is_err() {
            return TickPageResult::Error("invalid tick history snapshot");
        }
        if active.completed_pages >= MAX_ACTIVE_TICK_PAGES {
            return TickPageResult::Limit(active.request.clone());
        }
        let accepted_range = if snapshot.complete {
            Some(range)
        } else {
            // A truncated snapshot is the oldest prefix of the requested
            // history. Its final millisecond may straddle the page boundary;
            // retain only earlier ticks and re-read that millisecond next.
            snapshot.ticks.last().and_then(|last| {
                snapshot
                    .ticks
                    .first()
                    .filter(|first| first.time_ms < last.time_ms)
                    .map(|_| trading_core::volume_profile::TickRange {
                        start_ms: range.start_ms,
                        end_ms: last.time_ms,
                    })
            })
        };
        if let Some(accepted) = accepted_range {
            snapshot.to_ms = accepted.end_ms;
            let count = snapshot
                .ticks
                .partition_point(|tick| tick.time_ms < accepted.end_ms);
            snapshot.ticks.truncate(count);
            snapshot.complete = true;
            self.insert_cache(accepted, snapshot.clone());
            self.cache_trim();
        }
        let active = self.active.as_mut().expect("active checked above");
        active.completed_pages += 1;
        if let Some(accepted) = accepted_range {
            if Self::store_page(active, snapshot).is_err() {
                return TickPageResult::Limit(active.request.clone());
            }
            if accepted.end_ms == range.end_ms {
                active.gaps.remove(0);
            } else {
                active.gaps[0].start_ms = accepted.end_ms;
            }
        } else if range.end_ms - range.start_ms > 1 {
            let mid = range.start_ms + (range.end_ms - range.start_ms) / 2;
            active.gaps.retain(|gap| *gap != range);
            active.gaps.push(trading_core::volume_profile::TickRange {
                start_ms: range.start_ms,
                end_ms: mid,
            });
            active.gaps.push(trading_core::volume_profile::TickRange {
                start_ms: mid,
                end_ms: range.end_ms,
            });
        } else {
            if Self::store_page(active, snapshot).is_err() {
                return TickPageResult::Limit(active.request.clone());
            }
            active.incomplete = true;
            active.gaps.retain(|gap| *gap != range);
        }
        if active.gaps.is_empty() {
            let request = active.request.clone();
            if let Some(mut compact) = active.compact.take() {
                compact.complete = !active.incomplete;
                return TickPageResult::Streamed(compact, request);
            }
            return match Self::aggregate(&request, &active.parts, !active.incomplete) {
                Ok(snapshot) => TickPageResult::Final(snapshot, request),
                Err(error) => TickPageResult::Error(error),
            };
        }
        if active.completed_pages >= MAX_ACTIVE_TICK_PAGES {
            return TickPageResult::Limit(active.request.clone());
        }
        let next = active.gaps.first().copied().expect("non-empty gaps");
        let page = Self::page_request(active, next);
        TickPageResult::Next(page)
    }

    pub(crate) fn finish(&mut self) {
        self.active = None;
        self.cache_trim();
    }

    pub(crate) fn ingest_price_counts(
        &mut self,
        generation: u64,
        snapshot: TickPriceHistorySnapshot,
    ) -> TickPageResult {
        let Some(active) = self.active.as_mut() else {
            return TickPageResult::Stale;
        };
        let range = trading_core::volume_profile::TickRange {
            start_ms: snapshot.from_ms,
            end_ms: snapshot.to_ms,
        };
        if active.generation != generation
            || active.request.wire.symbol != snapshot.symbol
            || active.gaps.first().copied() != Some(range)
        {
            return TickPageResult::Stale;
        }
        if snapshot
            .validate(&Self::page_request(active, range).wire)
            .is_err()
        {
            return TickPageResult::Error("invalid tick price history snapshot");
        }
        if active.completed_pages >= MAX_ACTIVE_TICK_PAGES {
            return TickPageResult::Limit(active.request.clone());
        }
        if active.compact.is_none() {
            let mut compact = CompactTickProfile {
                tick_size: snapshot.tick_size.clone(),
                complete: false,
                counts: FixedRangeProfileAccumulator::new(MAX_PROFILE_PRICES),
            };
            for part in &active.parts {
                if Self::accumulate_page(&mut compact, part).is_err() {
                    return TickPageResult::Limit(active.request.clone());
                }
            }
            active.parts.clear();
            active.compact = Some(compact);
        }
        let compact = active.compact.as_mut().expect("compact initialized");
        if Self::accumulate_summary(compact, &snapshot).is_err() {
            return TickPageResult::Limit(active.request.clone());
        }
        if snapshot.through_ms > snapshot.from_ms && snapshot.through_ms <= super::now_ms() {
            let mut cached = snapshot.clone();
            cached.to_ms = cached.through_ms;
            cached.complete = true;
            self.price_entries.retain(|old| {
                old.symbol != cached.symbol
                    || old.to_ms <= cached.from_ms
                    || old.from_ms >= cached.to_ms
            });
            self.price_entries.push_back(cached);
            let mut prices = self
                .price_entries
                .iter()
                .map(|page| page.prices.len())
                .sum::<usize>();
            while self.price_entries.len() > 128 || prices > MAX_PROFILE_PRICES {
                if let Some(page) = self.price_entries.pop_front() {
                    prices -= page.prices.len();
                } else {
                    break;
                }
            }
        }
        active.completed_pages += 1;
        active.loaded_ticks += snapshot.loaded_ticks as usize;
        if snapshot.complete {
            active.gaps.remove(0);
        } else if snapshot.through_ms > range.start_ms {
            active.gaps[0].start_ms = snapshot.through_ms;
        } else if range.end_ms - range.start_ms > 1 {
            let mid = range.start_ms + (range.end_ms - range.start_ms) / 2;
            active.gaps[0].end_ms = mid;
            active.gaps.insert(
                1,
                trading_core::volume_profile::TickRange {
                    start_ms: mid,
                    end_ms: range.end_ms,
                },
            );
        } else {
            // Cannot certify an overflowing millisecond; never count a sampled prefix.
            return TickPageResult::Limit(active.request.clone());
        }
        if active.gaps.is_empty() {
            let mut compact = active.compact.take().expect("compact initialized");
            compact.complete = !active.incomplete;
            return TickPageResult::Streamed(compact, active.request.clone());
        }
        if active.completed_pages >= MAX_ACTIVE_TICK_PAGES {
            return TickPageResult::Limit(active.request.clone());
        }
        TickPageResult::Next(Self::page_request(active, active.gaps[0]))
    }

    fn accumulate_summary(
        compact: &mut CompactTickProfile,
        snapshot: &TickPriceHistorySnapshot,
    ) -> Result<(), &'static str> {
        if compact.tick_size != snapshot.tick_size {
            return Err("tick size changed during tick profile");
        }
        for item in &snapshot.prices {
            if compact
                .counts
                .merge_price_counts(
                    item.price.parse().expect("validated price"),
                    [
                        u64::from(item.total),
                        u64::from(item.bid),
                        u64::from(item.ask),
                    ],
                    item.bid_seen,
                )
                .is_err()
            {
                return Err("too many distinct profile prices");
            }
        }
        let quotes = snapshot
            .min_quote
            .as_ref()
            .zip(snapshot.max_quote.as_ref())
            .map(|(low, high)| {
                (
                    low.parse().expect("validated minimum"),
                    high.parse().expect("validated maximum"),
                )
            });
        if compact
            .counts
            .merge_quote_range(u64::from(snapshot.rejected_ticks), quotes)
            .is_err()
        {
            return Err("too many distinct profile prices");
        }
        Ok(())
    }

    pub(crate) fn final_streamed_from_cache(
        &mut self,
    ) -> Option<(CompactTickProfile, TickProfileRequest)> {
        let active = self.active.as_mut()?;
        if !active.gaps.is_empty() {
            return None;
        }
        let mut compact = active.compact.take()?;
        compact.complete = !active.incomplete;
        Some((compact, active.request.clone()))
    }

    pub(crate) fn final_from_cache(
        &self,
    ) -> Result<(TickHistorySnapshot, TickProfileRequest), &'static str> {
        let Some(active) = self.active.as_ref() else {
            return Err("tick profile is not active");
        };
        if !active.gaps.is_empty() {
            return Err("tick profile still has pending pages");
        }
        Self::aggregate(&active.request, &active.parts, true)
            .map(|snapshot| (snapshot, active.request.clone()))
    }

    fn store_page(
        active: &mut ActiveTickProfile,
        snapshot: TickHistorySnapshot,
    ) -> Result<(), &'static str> {
        let count = snapshot.ticks.len();
        if active.compact.is_none()
            && count > MAX_RETAINED_PROFILE_TICKS.saturating_sub(active.loaded_ticks)
        {
            let mut compact = CompactTickProfile {
                tick_size: snapshot.tick_size.clone(),
                complete: false,
                counts: FixedRangeProfileAccumulator::new(MAX_PROFILE_PRICES),
            };
            for part in &active.parts {
                Self::accumulate_page(&mut compact, part)?;
            }
            active.parts.clear();
            active.compact = Some(compact);
        }
        if let Some(compact) = active.compact.as_mut() {
            Self::accumulate_page(compact, &snapshot)?;
        } else {
            active.parts.push(snapshot);
        }
        active.loaded_ticks += count;
        Ok(())
    }

    fn accumulate_page(
        compact: &mut CompactTickProfile,
        snapshot: &TickHistorySnapshot,
    ) -> Result<(), &'static str> {
        if compact.tick_size != snapshot.tick_size {
            return Err("tick size changed during tick profile");
        }
        for tick in &snapshot.ticks {
            compact.counts.push(&ProfileTick {
                time_millis: tick.time_ms,
                bid: tick.bid.parse().map_err(|_| "invalid tick bid")?,
                ask: tick.ask.parse().map_err(|_| "invalid tick ask")?,
                flags: tick.flags,
            })?;
        }
        Ok(())
    }

    pub(crate) fn insert_cache(
        &mut self,
        range: trading_core::volume_profile::TickRange,
        snapshot: TickHistorySnapshot,
    ) {
        if self.entries.iter().any(|item| {
            item.snapshot.symbol == snapshot.symbol
                && item.range.start_ms < range.end_ms
                && range.start_ms < item.range.end_ms
        }) {
            return;
        }
        self.entries.push_back(CachedTickRange { range, snapshot });
    }

    pub(crate) fn cache_trim(&mut self) {
        const MAX_RANGES: usize = 128;
        const MAX_TICKS: usize = 100_000;
        let mut total: usize = self
            .entries
            .iter()
            .map(|entry| entry.snapshot.ticks.len())
            .sum();
        while self.entries.len() > MAX_RANGES || total > MAX_TICKS {
            if self.entries.len() <= MAX_RANGES {
                let Some(oldest) = self.entries.front_mut() else {
                    break;
                };
                let excess = total - MAX_TICKS;
                if excess < oldest.snapshot.ticks.len() {
                    // Large pages should not force eviction of a whole page
                    // when only a prefix exceeds the cache's tick budget.
                    let boundary = oldest.snapshot.ticks[excess - 1].time_ms;
                    let discard = oldest
                        .snapshot
                        .ticks
                        .partition_point(|tick| tick.time_ms <= boundary);
                    if discard < oldest.snapshot.ticks.len() {
                        oldest.range.start_ms = oldest.snapshot.ticks[discard].time_ms;
                        oldest.snapshot.from_ms = oldest.range.start_ms;
                        oldest.snapshot.ticks.drain(..discard);
                        total -= discard;
                        continue;
                    }
                }
            }
            let Some(remove) = self.entries.pop_front() else {
                break;
            };
            total = total.saturating_sub(remove.snapshot.ticks.len());
        }
    }
}
