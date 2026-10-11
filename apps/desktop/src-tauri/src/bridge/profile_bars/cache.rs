//! In-memory bar series behind the approximate profile (see [`super`]).

use crate::bridge::{MAX_CACHED_BAR_SERIES, MAX_PROFILE_BARS, MAX_REMEMBERED_HISTORY_STARTS};
use std::collections::VecDeque;
use trading_core::volume_profile::BarSeries;

/// Bar series kept between profile requests, least recently used last. The
/// symbol and timeframe key an entry; the session is implied because the
/// cache is cleared wherever the tick cache is (handshake, disconnect) and the
/// symbol check drops other symbols on a symbol change.
#[derive(Debug, Default)]
pub(crate) struct ProfileBarCache {
    entries: VecDeque<(String, BarSeries)>,
    /// Open time of the oldest bar the broker has, per symbol and timeframe,
    /// for histories found to start inside a requested range. Kept apart from
    /// the series because the bars of an abandoned timeframe are evicted long
    /// before the knowledge that it has nothing older stops being useful.
    history_starts: VecDeque<(String, String, i64)>,
}

impl ProfileBarCache {
    fn position(&self, symbol: &str, timeframe: &str) -> Option<usize> {
        self.entries
            .iter()
            .position(|(held, series)| held == symbol && series.timeframe() == timeframe)
    }

    pub(crate) fn get(&self, symbol: &str, timeframe: &str) -> Option<&BarSeries> {
        self.position(symbol, timeframe)
            .map(|index| &self.entries[index].1)
    }

    pub(super) fn get_mut(&mut self, symbol: &str, timeframe: &str) -> Option<&mut BarSeries> {
        let index = self.position(symbol, timeframe)?;
        Some(&mut self.entries[index].1)
    }

    pub(crate) fn remove(&mut self, symbol: &str, timeframe: &str) {
        if let Some(index) = self.position(symbol, timeframe) {
            self.entries.remove(index);
        }
    }

    /// Stores `series` as the most recently used entry (replacing its key),
    /// bounded in bars per series and in series held.
    pub(crate) fn store(&mut self, symbol: &str, mut series: BarSeries) {
        self.remove(symbol, series.timeframe());
        series.truncate_oldest(usize::try_from(MAX_PROFILE_BARS).unwrap_or(usize::MAX));
        self.entries.push_back((symbol.to_owned(), series));
        while self.entries.len() > MAX_CACHED_BAR_SERIES {
            self.entries.pop_front();
        }
    }

    pub(super) fn mark_used(&mut self, symbol: &str, timeframe: &str) {
        if let Some(index) = self.position(symbol, timeframe) {
            if let Some(entry) = self.entries.remove(index) {
                self.entries.push_back(entry);
            }
        }
    }

    /// Remembers that the broker's `timeframe` history for `symbol` starts at
    /// `oldest_ms`, so a later request does not page back to find that out.
    pub(super) fn remember_history_start(&mut self, symbol: &str, timeframe: &str, oldest_ms: i64) {
        self.forget_history_start(symbol, timeframe);
        self.history_starts
            .push_back((symbol.to_owned(), timeframe.to_owned(), oldest_ms));
        while self.history_starts.len() > MAX_REMEMBERED_HISTORY_STARTS {
            self.history_starts.pop_front();
        }
    }

    pub(super) fn forget_history_start(&mut self, symbol: &str, timeframe: &str) {
        self.history_starts
            .retain(|(held, held_timeframe, _)| held != symbol || held_timeframe != timeframe);
    }

    /// The remembered history start when it lies after `from_ms`, i.e. the
    /// timeframe cannot cover a range starting at `from_ms`.
    pub(super) fn history_starting_after(
        &self,
        symbol: &str,
        timeframe: &str,
        from_ms: i64,
    ) -> Option<i64> {
        self.history_starts
            .iter()
            .find(|(held, held_timeframe, _)| held == symbol && held_timeframe == timeframe)
            .map(|&(_, _, oldest_ms)| oldest_ms)
            .filter(|&oldest_ms| oldest_ms > from_ms)
    }

    pub(crate) fn retain_symbol(&mut self, symbol: Option<&str>) {
        self.entries
            .retain(|(held, _)| Some(held.as_str()) == symbol);
        self.history_starts
            .retain(|(held, _, _)| Some(held.as_str()) == symbol);
    }

    pub(crate) fn clear(&mut self) {
        self.entries.clear();
        self.history_starts.clear();
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }
}
