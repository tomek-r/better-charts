//! A contiguous, time-ordered run of bars of one timeframe that a caller keeps
//! between approximate-profile requests, so a refresh only fetches what is
//! new instead of paging the whole range again.
//!
//! The pure bookkeeping lives here (coverage, merging, validation); the
//! transport decides when and how pages are fetched. Every operation fails
//! closed: on any inconsistency the caller drops the series and fetches fresh.
//!
//! Invariants: bar open times are strictly increasing, the series is never
//! empty, and every bar strictly older than the newest one is final. The
//! newest bar may still be forming, so it is always re-fetched.

use crate::protocol::MarketCandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BarSeriesError {
    Empty,
    /// Open times are not strictly increasing (disorder or duplicates).
    NotStrictlyIncreasing,
    /// The new bars neither overlap nor touch the held series, so merging
    /// them would leave a hole.
    Gap,
    /// The overlap of old and new bars disagrees on which bars exist.
    OverlapMismatch,
}

/// What a request for `[from_ms, to_ms)` still needs fetched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BarCoverage {
    /// Newer bars from the range end back to (and including) the newest held
    /// bar are missing or may have changed.
    pub refresh_newest: bool,
    /// Bars older than the oldest held bar are missing.
    pub extend_older: bool,
}

impl BarCoverage {
    pub fn is_complete(&self) -> bool {
        !self.refresh_newest && !self.extend_older
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct BarSeries {
    timeframe: String,
    bars: Vec<MarketCandle>,
    /// The oldest held bar is the first the broker has.
    history_start_reached: bool,
}

fn check_increasing(bars: &[MarketCandle]) -> Result<(), BarSeriesError> {
    if bars.is_empty() {
        return Err(BarSeriesError::Empty);
    }
    if bars
        .windows(2)
        .any(|pair| pair[0].time_ms >= pair[1].time_ms)
    {
        return Err(BarSeriesError::NotStrictlyIncreasing);
    }
    Ok(())
}

impl BarSeries {
    /// `bars` must be oldest first with strictly increasing open times.
    pub fn new(
        timeframe: &str,
        bars: Vec<MarketCandle>,
        history_start_reached: bool,
    ) -> Result<Self, BarSeriesError> {
        check_increasing(&bars)?;
        Ok(Self {
            timeframe: timeframe.to_owned(),
            bars,
            history_start_reached,
        })
    }

    pub fn timeframe(&self) -> &str {
        &self.timeframe
    }

    pub fn len(&self) -> usize {
        self.bars.len()
    }

    pub fn is_empty(&self) -> bool {
        self.bars.is_empty()
    }

    pub fn bars(&self) -> &[MarketCandle] {
        &self.bars
    }

    pub fn oldest_ms(&self) -> i64 {
        self.bars[0].time_ms
    }

    pub fn newest_ms(&self) -> i64 {
        self.bars[self.bars.len() - 1].time_ms
    }

    pub fn history_start_reached(&self) -> bool {
        self.history_start_reached
    }

    /// What must be fetched to answer `[from_ms, to_ms)`. Bars overlapping the
    /// range open before `to_ms`; the newest held bar is only needed (and only
    /// suspect) when the range reaches it.
    pub fn coverage(&self, from_ms: i64, to_ms: i64) -> BarCoverage {
        BarCoverage {
            refresh_newest: to_ms > self.newest_ms(),
            extend_older: !self.history_start_reached && self.oldest_ms() > from_ms,
        }
    }

    /// Held bars that can overlap `[from_ms, to_ms)`: from the bar containing
    /// `from_ms` (the last one opening at or before it) up to those opening
    /// before `to_ms`. Callers still filter edge bars exactly.
    pub fn covering(&self, from_ms: i64, to_ms: i64) -> &[MarketCandle] {
        let after_from = self.bars.partition_point(|bar| bar.time_ms <= from_ms);
        let start = after_from.saturating_sub(1);
        let end = self.bars.partition_point(|bar| bar.time_ms < to_ms);
        &self.bars[start..end.max(start)]
    }

    /// Merges freshly fetched newer bars (oldest first). They must reach back
    /// to the newest held bar, which they replace (it may have been forming);
    /// where they overlap held bars they must list the same open times.
    /// `fresh_reaches_history_start` says the fresh walk ended at the broker's
    /// first bar; it only matters when the fresh bars swallow the whole series.
    pub fn merge_newer(
        &mut self,
        fresh: Vec<MarketCandle>,
        fresh_reaches_history_start: bool,
    ) -> Result<(), BarSeriesError> {
        check_increasing(&fresh)?;
        let fresh_oldest = fresh[0].time_ms;
        if fresh_oldest > self.newest_ms() {
            return Err(BarSeriesError::Gap);
        }
        let overlap_start = self.bars.partition_point(|bar| bar.time_ms < fresh_oldest);
        let held_overlap = &self.bars[overlap_start..];
        let (oldest_held, newest_held) = (self.oldest_ms(), self.newest_ms());
        let fresh_overlap = fresh
            .iter()
            .filter(|bar| bar.time_ms >= oldest_held && bar.time_ms <= newest_held);
        if held_overlap
            .iter()
            .map(|bar| bar.time_ms)
            .ne(fresh_overlap.map(|bar| bar.time_ms))
        {
            return Err(BarSeriesError::OverlapMismatch);
        }
        self.bars.truncate(overlap_start);
        if overlap_start == 0 {
            self.history_start_reached = fresh_reaches_history_start;
        }
        self.bars.extend(fresh);
        Ok(())
    }

    /// Prepends bars older than the series (oldest first). The page walk that
    /// fetched them started at the oldest held bar, so they are contiguous.
    pub fn merge_older(
        &mut self,
        older: Vec<MarketCandle>,
        reaches_history_start: bool,
    ) -> Result<(), BarSeriesError> {
        check_increasing(&older)?;
        if older[older.len() - 1].time_ms >= self.oldest_ms() {
            return Err(BarSeriesError::NotStrictlyIncreasing);
        }
        let mut merged = older;
        merged.append(&mut self.bars);
        self.bars = merged;
        self.history_start_reached = reaches_history_start;
        Ok(())
    }

    /// Records that nothing older than the oldest held bar exists.
    pub fn mark_history_start_reached(&mut self) {
        self.history_start_reached = true;
    }

    /// Keeps at most `max_bars` of the newest bars (memory bound).
    pub fn truncate_oldest(&mut self, max_bars: usize) {
        if self.bars.len() > max_bars.max(1) {
            let excess = self.bars.len() - max_bars.max(1);
            self.bars.drain(..excess);
            self.history_start_reached = false;
        }
    }
}

#[cfg(test)]
#[path = "bar_series_tests.rs"]
mod tests;
