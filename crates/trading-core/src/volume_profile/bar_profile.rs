//! Approximate Fixed Range Volume Profile built from OHLC bars, plus the
//! load estimate that decides whether the exact tick profile is affordable.
//!
//! Bars carry no price distribution inside their `[low, high]` range, so this
//! profile is an approximation: a bar's tick volume is spread uniformly over
//! the price range. It exists for ranges whose tick load is too large.

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;

use super::fixed_range::{finish_profile, FixedRangeProfile, FixedRangeProfileConfig, RowGrid};
use crate::protocol::{timeframe_seconds, MarketCandle};

/// Expected cost of the exact tick profile over a range, derived from bars.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ProfileLoadEstimate {
    /// Sum of the bars' tick volume, saturating at `u64::MAX`.
    pub ticks: u64,
    /// Upper bound of distinct BID and ASK price levels the tick accumulator
    /// would hold.
    pub distinct_prices: u64,
}

/// What the exact tick profile can afford; the caller owns the numbers (the
/// desktop budget, the accumulator and page limits) so this crate stays free
/// of transport constants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProfileBudget {
    pub max_ticks: u64,
    pub max_distinct_prices: u64,
    pub max_pages: u64,
    /// Ticks one wire page carries (the negotiated maximum).
    pub ticks_per_page: u64,
}

impl ProfileLoadEstimate {
    /// True when any limit of the tick path would be hit: too many ticks,
    /// too many distinct prices, or more pages than the load may span.
    /// Bounds are inclusive (`==` still fits). A zero `ticks_per_page` is
    /// treated as unaffordable.
    pub fn exceeds(&self, budget: &ProfileBudget) -> bool {
        self.ticks > budget.max_ticks
            || self.distinct_prices > budget.max_distinct_prices
            || budget.ticks_per_page == 0
            || self.ticks.div_ceil(budget.ticks_per_page) > budget.max_pages
    }
}

/// A bar with parsed, validated prices.
struct ParsedBar {
    open: Decimal,
    high: Decimal,
    low: Decimal,
    close: Decimal,
    volume: u64,
    spread: u32,
}

fn parse_bar(candle: &MarketCandle) -> Result<ParsedBar, &'static str> {
    candle.validate()?;
    let parse = |value: &str| {
        value
            .parse::<Decimal>()
            .map_err(|_| "invalid decimal price")
    };
    let bar = ParsedBar {
        open: parse(&candle.open)?,
        high: parse(&candle.high)?,
        low: parse(&candle.low)?,
        close: parse(&candle.close)?,
        volume: candle.tick_volume,
        spread: candle.spread,
    };
    if bar.low <= Decimal::ZERO || bar.high < bar.low {
        return Err("invalid bar range");
    }
    for price in [bar.open, bar.close] {
        if price < bar.low || price > bar.high {
            return Err("bar open/close outside high/low");
        }
    }
    Ok(bar)
}

/// Estimates the tick load of a range from the bars covering it (the caller
/// restricts `bars` to the range). `point` is the symbol's point size, used
/// to turn the integer bar spread into a price.
///
/// `distinct_prices` is `ceil((max_high + max_spread * point - min_low) /
/// tick_size) + 1`. It is an upper bound because every BID lies inside its
/// bar's `[low, high]` and every ASK equals a BID plus the quoted spread, so
/// all quote prices fall in `[min_low, max_high + max_spread * point]`, and at
/// most one price per `tick_size` step fits in that interval (the `+ 1`
/// covers both ends, the ceiling covers unaligned prices). Empty `bars` give
/// zeros. Errors on a non-positive `tick_size`, a negative `point`, or a bar
/// with an invalid price.
pub fn estimate_profile_load(
    bars: &[MarketCandle],
    tick_size: Decimal,
    point: Decimal,
) -> Result<ProfileLoadEstimate, &'static str> {
    if tick_size <= Decimal::ZERO || point < Decimal::ZERO {
        return Err("invalid tick size or point");
    }
    let mut ticks = 0u64;
    let mut bounds: Option<(Decimal, Decimal, u32)> = None;
    for candle in bars {
        let bar = parse_bar(candle)?;
        ticks = ticks.saturating_add(bar.volume);
        bounds = Some(match bounds {
            None => (bar.low, bar.high, bar.spread),
            Some((low, high, spread)) => {
                (low.min(bar.low), high.max(bar.high), spread.max(bar.spread))
            }
        });
    }
    let Some((low, high, spread)) = bounds else {
        return Ok(ProfileLoadEstimate::default());
    };
    let top = high
        .checked_add(
            Decimal::from(spread)
                .checked_mul(point)
                .ok_or("price overflow")?,
        )
        .ok_or("price overflow")?;
    let steps = ((top - low) / tick_size).ceil() + Decimal::ONE;
    let distinct_prices = steps.to_u64().unwrap_or(u64::MAX);
    Ok(ProfileLoadEstimate {
        ticks,
        distinct_prices,
    })
}

/// Builds an APPROXIMATE Fixed Range Volume Profile from bars the caller has
/// already restricted to the range.
///
/// # Series mapping (bar profiles: bid = down, ask = up)
///
/// A bar has no bid/ask information, so the two split series of
/// [`FixedRangeProfile`] carry the bar direction instead: the ASK series
/// (`ask`, `ask_poc`, ...) holds UP volume (`close > open`) and the BID
/// series (`bid`, `bid_poc`, ...) holds DOWN volume (`close < open`). A doji
/// (`close == open`) splits half and half, the odd unit going to up. The
/// total series is all volume, so `total == bid + ask` in every bin.
///
/// # Distribution
///
/// The grid is exactly the tick profile's (see the "Bins" rules of
/// [`calculate_fixed_range_profile`](super::calculate_fixed_range_profile)),
/// anchored at the lowest low and the highest high of the bars that carry
/// volume. Each bar's up and down volume is spread over its `[low, high]`
/// interval in proportion to the overlap with each row, using integer
/// largest-remainder apportionment: a bar's volume is preserved exactly and
/// ties go to the lower-priced row. A bar with `low == high` lands entirely
/// in its row. POC/VAH/VAL use the tick profile's value-area routine.
///
/// Bars without volume are validated but ignored. No volume at all, or an
/// unusable configuration (`rows == 0`, non-positive `tick_size`), returns
/// the tick profile's empty shape. An invalid bar (non-positive or
/// unparsable price, `high < low`, `open`/`close` outside `[low, high]`, or
/// prices too precise to apportion) is an error; nothing is guessed.
pub fn calculate_bar_profile(
    bars: &[MarketCandle],
    config: &FixedRangeProfileConfig,
) -> Result<FixedRangeProfile, &'static str> {
    let parsed = bars.iter().map(parse_bar).collect::<Result<Vec<_>, _>>()?;
    if config.tick_size <= Decimal::ZERO || config.rows == 0 {
        return Ok(FixedRangeProfile::empty(0));
    }
    let mut volume_bars = parsed.iter().filter(|bar| bar.volume > 0).peekable();
    let Some(first) = volume_bars.peek() else {
        return Ok(FixedRangeProfile::empty(0));
    };
    let (mut min_price, mut max_price) = (first.low, first.high);
    for bar in volume_bars {
        min_price = min_price.min(bar.low);
        max_price = max_price.max(bar.high);
    }

    let grid = RowGrid::new(min_price, max_price, config);
    let mut bins = grid.bins();
    for bar in parsed.iter().filter(|bar| bar.volume > 0) {
        let (up, down) = split_volume(bar);
        let first_row = grid.row_of(bar.low);
        let last_row = grid.row_of(bar.high);
        let overlaps = row_overlaps(&grid, bar, first_row, last_row);
        let up_shares = apportion(up, &overlaps)?;
        let down_shares = apportion(down, &overlaps)?;
        for (offset, (up_share, down_share)) in up_shares.into_iter().zip(down_shares).enumerate() {
            let bin = &mut bins[first_row + offset];
            bin.ask += up_share;
            bin.bid += down_share;
            bin.total += up_share + down_share;
        }
    }
    Ok(finish_profile(bins, config.value_area_percent, 0))
}

/// `(up, down)` volume of a bar; see [`calculate_bar_profile`].
fn split_volume(bar: &ParsedBar) -> (u64, u64) {
    match bar.close.cmp(&bar.open) {
        std::cmp::Ordering::Greater => (bar.volume, 0),
        std::cmp::Ordering::Less => (0, bar.volume),
        std::cmp::Ordering::Equal => (bar.volume - bar.volume / 2, bar.volume / 2),
    }
}

/// Integer overlap weights of the bar with rows `first_row..=last_row`, all
/// expressed in the same decimal unit. A flat bar has weight `1` on its row.
fn row_overlaps(grid: &RowGrid, bar: &ParsedBar, first_row: usize, last_row: usize) -> Vec<u128> {
    if bar.low == bar.high {
        return vec![1];
    }
    let overlaps = (first_row..=last_row)
        .map(|row| {
            let row_low = grid.row_low(row);
            let row_high = row_low + grid.row_width();
            (bar.high.min(row_high) - bar.low.max(row_low)).max(Decimal::ZERO)
        })
        .collect::<Vec<_>>();
    let scale = overlaps.iter().map(Decimal::scale).max().unwrap_or(0);
    overlaps
        .into_iter()
        .map(|mut overlap| {
            overlap.rescale(scale);
            overlap.mantissa().unsigned_abs()
        })
        .collect()
}

/// Splits `volume` over `weights` proportionally with the largest-remainder
/// method; the shares sum to `volume`. Remainder ties go to the lower index
/// (lower price). All-zero weights cannot occur for a bar with `low < high`
/// (the overlaps sum to the bar's range), but fall back to the first row.
fn apportion(volume: u64, weights: &[u128]) -> Result<Vec<u64>, &'static str> {
    let total: u128 = weights.iter().sum();
    if volume == 0 || total == 0 {
        let mut shares = vec![0; weights.len()];
        shares[0] = volume;
        return Ok(shares);
    }
    let mut shares = Vec::with_capacity(weights.len());
    let mut remainders = Vec::with_capacity(weights.len());
    for &weight in weights {
        let scaled = u128::from(volume)
            .checked_mul(weight)
            .ok_or("bar prices too precise to apportion")?;
        shares.push((scaled / total) as u64);
        remainders.push((scaled % total, shares.len() - 1));
    }
    let assigned: u64 = shares.iter().sum();
    remainders.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    for &(_, index) in remainders.iter().take((volume - assigned) as usize) {
        shares[index] += 1;
    }
    Ok(shares)
}

/// Picks the smallest timeframe among `candidates` (wire codes, any order,
/// unknown codes ignored) whose nominal bar count over `range_ms` is at most
/// `max_bars`. The count is `ceil(range_ms / bar_length)` with the nominal
/// lengths of `config/timeframes.json` (MN1 = 30 days). `None` when nothing
/// fits, `range_ms <= 0` or `max_bars == 0`.
pub fn bar_timeframe_for_range(
    range_ms: i64,
    candidates: &[String],
    max_bars: u64,
) -> Option<&str> {
    if range_ms <= 0 || max_bars == 0 {
        return None;
    }
    let range_ms = range_ms as u64;
    candidates
        .iter()
        .filter_map(|code| Some((timeframe_seconds(code)?, code.as_str())))
        .filter(|&(seconds, _)| range_ms.div_ceil(u64::from(seconds) * 1000) <= max_bars)
        .min_by_key(|&(seconds, _)| seconds)
        .map(|(_, code)| code)
}

/// Fallback timeframes for a range whose history ends before its start:
/// from `candidates` (unknown codes ignored), up to `limit` timeframes, each
/// at least twice as coarse as the one before it (starting from `timeframe`)
/// and none coarser than `coarsest`, finest first. Neighbouring timeframes
/// (M2/M3) are built from the same base history and end at the same place, so
/// only a clearly coarser one is worth another walk. A coarser timeframe
/// covers the same range with fewer bars, so it fits any bar bound the finer
/// one fits. Empty when `timeframe` or `coarsest` is unknown.
pub fn bar_timeframes_coarser_than<'a>(
    timeframe: &str,
    candidates: &'a [String],
    coarsest: &str,
    limit: usize,
) -> Vec<&'a str> {
    let (Some(floor), Some(ceiling)) = (timeframe_seconds(timeframe), timeframe_seconds(coarsest))
    else {
        return Vec::new();
    };
    let mut known: Vec<(u32, &str)> = candidates
        .iter()
        .filter_map(|code| Some((timeframe_seconds(code)?, code.as_str())))
        .filter(|&(seconds, _)| seconds <= ceiling)
        .collect();
    known.sort_by_key(|&(seconds, _)| seconds);
    let mut picked = Vec::new();
    let mut previous = floor;
    for (seconds, code) in known {
        if picked.len() == limit {
            break;
        }
        if seconds >= previous.saturating_mul(2) {
            picked.push(code);
            previous = seconds;
        }
    }
    picked
}

/// Open time of the oldest of `bars` (oldest first) when it opens after
/// `from_ms`: the broker's history starts inside the range, so the profile
/// does not cover its beginning. `None` when the range start is covered (the
/// oldest bar opens at or before it) or `bars` is empty.
pub fn partial_coverage_start(bars: &[MarketCandle], from_ms: i64) -> Option<i64> {
    bars.first()
        .map(|bar| bar.time_ms)
        .filter(|&oldest| oldest > from_ms)
}

/// Open time of the bar after the one opening at `open_ms`: the nominal length
/// for every timeframe except `MN1`, which is the next calendar month (UTC).
/// `None` for an unknown timeframe or on overflow.
pub fn bar_close_ms(open_ms: i64, timeframe: &str) -> Option<i64> {
    let seconds = i64::from(timeframe_seconds(timeframe)?);
    if timeframe != "MN1" {
        return open_ms.checked_add(seconds.checked_mul(1000)?);
    }
    let days = open_ms.div_euclid(86_400_000);
    let (year, month, _) = civil_from_days(days);
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    // A month bar opens on the 1st, so the next month's 1st is its close; a
    // mid-month open (never produced by MT5) still ends on that boundary.
    let next_open = days_from_civil(next_year, next_month, 1) * 86_400_000;
    Some(next_open)
}

/// Howard Hinnant's days-from-civil, proleptic Gregorian, days since 1970-01-01.
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let day_of_year = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Keeps the bars that overlap `[from_ms, end_ms)`: a bar opening before
/// `end_ms` whose close is after `from_ms`. Edge bars stay whole (a bar has no
/// intra-bar time distribution), which is part of why a bar profile is only
/// approximate. Errors on an unknown timeframe.
pub fn bars_overlapping_range(
    bars: &[MarketCandle],
    timeframe: &str,
    from_ms: i64,
    end_ms: i64,
) -> Result<Vec<MarketCandle>, &'static str> {
    let mut kept = Vec::new();
    for bar in bars {
        let close = bar_close_ms(bar.time_ms, timeframe).ok_or("unknown bar timeframe")?;
        if bar.time_ms < end_ms && close > from_ms {
            kept.push(bar.clone());
        }
    }
    Ok(kept)
}

#[cfg(test)]
#[path = "bar_profile_tests.rs"]
mod tests;
