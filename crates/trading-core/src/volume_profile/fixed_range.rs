use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use super::{price_string, Tick, TICK_FLAG_ASK, TICK_FLAG_BID};

/// Configuration for [`calculate_fixed_range_profile`].
///
/// `rows` is the target bin count (default `128`), `tick_size` must be
/// positive, and `value_area_percent` is the fraction of total weight the
/// value area must cover (default `0.70`); values outside `[0, 1]` are
/// clamped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FixedRangeProfileConfig {
    pub rows: usize,
    pub tick_size: Decimal,
    pub value_area_percent: Decimal,
}

impl Default for FixedRangeProfileConfig {
    fn default() -> Self {
        Self {
            rows: 128,
            tick_size: Decimal::ONE,
            value_area_percent: Decimal::new(70, 2),
        }
    }
}

/// One histogram row of a fixed range profile. Prices are normalized
/// decimal strings; `low` is inclusive, `high` is exclusive, and
/// `center = low + (high - low) / 2`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixedRangeBin {
    pub low: String,
    pub high: String,
    pub center: String,
    pub total: u64,
    pub bid: u64,
    pub ask: u64,
}

/// Fixed Range Volume Profile over ticks already filtered to the range by
/// the caller. See [`calculate_fixed_range_profile`] for the weighting,
/// binning, and level rules. Prices are normalized decimal strings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FixedRangeProfile {
    pub bins: Vec<FixedRangeBin>,
    pub actual_rows: usize,
    pub rejected_ticks: u64,
    pub total_weight: u64,
    pub poc: Option<String>,
    pub vah: Option<String>,
    pub val: Option<String>,
    pub bid_poc: Option<String>,
    pub bid_vah: Option<String>,
    pub bid_val: Option<String>,
    pub ask_poc: Option<String>,
    pub ask_vah: Option<String>,
    pub ask_val: Option<String>,
}

impl FixedRangeProfile {
    /// Deterministic shape for an empty range or unusable configuration:
    /// empty histogram, zero counters, and every level `None`.
    fn empty(rejected_ticks: u64) -> Self {
        Self {
            bins: Vec::new(),
            actual_rows: 0,
            rejected_ticks,
            total_weight: 0,
            poc: None,
            vah: None,
            val: None,
            bid_poc: None,
            bid_vah: None,
            bid_val: None,
            ask_poc: None,
            ask_vah: None,
            ask_val: None,
        }
    }
}

/// Which histogram a weighted contribution belongs to.
#[derive(Clone, Copy)]
enum FixedRangeMode {
    Total,
    Bid,
    Ask,
}

/// Bin indices of a computed value area: POC bin plus the inclusive
/// `[low, high]` span of bins covered by the achieved area.
struct ValueAreaIndex {
    poc: usize,
    low: usize,
    high: usize,
}

/// Expands from the POC bin until the covered weight is at least
/// `value_area_percent` of the total: each step adds the adjacent bin with
/// the larger weight, the lower-priced side wins ties, and a range edge
/// expands the only available side. The POC is the lower-priced bin when
/// several bins share the greatest weight.
fn calculate_value_area(weights: &[u64], value_area_percent: Decimal) -> Option<ValueAreaIndex> {
    let total: u64 = weights.iter().sum();
    if total == 0 {
        return None;
    }
    let mut poc = 0;
    for (index, &weight) in weights.iter().enumerate().skip(1) {
        if weight > weights[poc] {
            poc = index;
        }
    }
    let target = Decimal::from(total) * value_area_percent;
    let mut area = Decimal::from(weights[poc]);
    let mut low = poc;
    let mut high = poc;
    while area < target && (low > 0 || high + 1 < weights.len()) {
        let take_left = match (low > 0, high + 1 < weights.len()) {
            (true, false) => true,
            (false, true) => false,
            (true, true) => weights[low - 1] >= weights[high + 1],
            (false, false) => break,
        };
        if take_left {
            low -= 1;
            area += Decimal::from(weights[low]);
        } else {
            high += 1;
            area += Decimal::from(weights[high]);
        }
    }
    Some(ValueAreaIndex { poc, low, high })
}

/// `(poc, vah, val)` price strings for one histogram, all `None` when the
/// histogram carries no weight.
fn level_strings(
    bins: &[FixedRangeBin],
    weights: &[u64],
    value_area_percent: Decimal,
) -> (Option<String>, Option<String>, Option<String>) {
    match calculate_value_area(weights, value_area_percent) {
        Some(area) => (
            Some(bins[area.poc].center.clone()),
            Some(bins[area.high].high.clone()),
            Some(bins[area.low].low.clone()),
        ),
        None => (None, None, None),
    }
}

/// Computes a Fixed Range Volume Profile over ticks the caller has already
/// filtered to the range of interest.
///
/// # Weights
///
/// Weights measure quote activity, not trade volume:
///
/// * Total: a valid tick with a Bid or Ask change flag contributes weight `1`
///   at the BID price, even when both sides change at once.
/// * Bid: a tick with [`TICK_FLAG_BID`] contributes `1` at the bid price.
/// * Ask: a tick with [`TICK_FLAG_ASK`] contributes `1` at the ask price.
/// * A tick with neither change flag contributes nothing.
/// * A tick with a non-positive bid or ask is rejected and counted in
///   [`FixedRangeProfile::rejected_ticks`], whether or not it carries change
///   flags. `rust_decimal::Decimal` cannot represent non-finite quotes
///   (`Decimal::from_f64(f64::NAN)` is `None`), so rejecting `<= 0` rejects
///   every quote that can reach this function.
///
/// The three histograms are accumulated independently: per-bin and overall
/// Bid+Ask sums may therefore differ from the Total histogram (a both-sides
/// tick adds 2 to Bid+Ask but 1 to Total; an ask-only tick adds Total weight
/// at its bid price while its Ask weight lands at the ask price). This is
/// intended product behavior. Flags are read with the module constants
/// [`TICK_FLAG_BID`] and [`TICK_FLAG_ASK`] (MT5/MQL5 values `2` and `4`),
/// the same constants [`calculate_volume_profile`] uses.
///
/// # Bins
///
/// `rows` is a target bin count, not an exact one. The deterministic width
/// rule keeps every edge on the `tick_size` grid:
///
/// 1. `min_aligned = floor(min_price / tick_size) * tick_size` anchors the
///    grid at a whole multiple of `tick_size` (over contributing prices only).
/// 2. `span_ticks = floor((max_price - min_aligned) / tick_size) + 1` counts
///    the tick-grid cells the contributing prices touch (always >= 1).
/// 3. `width_ticks = max(1, ceil(span_ticks / rows))` is the bin width in
///    whole ticks, so each bin width is a whole multiple of `tick_size`.
/// 4. Bin `k` covers `[min_aligned + k * width, min_aligned + (k+1) * width)`
///    with `width = width_ticks * tick_size`, and a price `p` maps to bin
///    `floor((p - min_aligned) / width)`. The actual row count is
///    `ceil(span_ticks / width_ticks)`, which never exceeds `rows` and is
///    smaller for a narrow range.
///
/// # Levels
///
/// POC is the CENTER of the greatest-weight bin; the lower-priced bin wins
/// ties. The value area starts at the POC bin and repeatedly adds the
/// adjacent bin with the larger weight (lower-priced side on ties, the
/// available side at a range edge) until the covered weight is at least
/// `value_area_percent` of the total. `val` is the lower edge of the lowest
/// included bin and `vah` the upper edge of the highest. The same rules
/// produce `bid_*` and `ask_*` levels from their own histograms; a level is
/// `None` when its histogram is empty.
///
/// An empty range (no valid flagged ticks, zero total weight) returns an
/// empty histogram with every level `None`, carrying `rejected_ticks` from
/// the input. A non-positive `tick_size` or `rows == 0` cannot define bins
/// and returns the same empty histogram (with `rejected_ticks == 0`);
/// `value_area_percent` outside `[0, 1]` is clamped to the nearest bound.
pub fn calculate_fixed_range_profile(
    config: &FixedRangeProfileConfig,
    ticks: &[Tick],
) -> FixedRangeProfile {
    if config.tick_size <= Decimal::ZERO || config.rows == 0 {
        return FixedRangeProfile::empty(0);
    }
    let mut rejected_ticks = 0u64;
    let mut contributions: Vec<(Decimal, FixedRangeMode, u64)> = Vec::new();
    for tick in ticks {
        // Quote validity is checked before the change flags: every
        // non-positive quote is rejected, flagged or not.
        if tick.bid <= Decimal::ZERO || tick.ask <= Decimal::ZERO {
            rejected_ticks += 1;
            continue;
        }
        let bid_changed = tick.flags & TICK_FLAG_BID != 0;
        let ask_changed = tick.flags & TICK_FLAG_ASK != 0;
        if !bid_changed && !ask_changed {
            continue;
        }
        // One total weight at the BID price per flagged tick, even when
        // both sides changed.
        contributions.push((tick.bid, FixedRangeMode::Total, 1));
        if bid_changed {
            contributions.push((tick.bid, FixedRangeMode::Bid, 1));
        }
        if ask_changed {
            contributions.push((tick.ask, FixedRangeMode::Ask, 1));
        }
    }
    calculate_fixed_range_contributions(config, contributions, rejected_ticks)
}

fn calculate_fixed_range_contributions(
    config: &FixedRangeProfileConfig,
    contributions: Vec<(Decimal, FixedRangeMode, u64)>,
    rejected_ticks: u64,
) -> FixedRangeProfile {
    if config.tick_size <= Decimal::ZERO || config.rows == 0 {
        return FixedRangeProfile::empty(0);
    }
    let value_area_percent = config
        .value_area_percent
        .max(Decimal::ZERO)
        .min(Decimal::ONE);
    if contributions.is_empty() {
        return FixedRangeProfile::empty(rejected_ticks);
    }

    let mut min_price = contributions[0].0;
    let mut max_price = min_price;
    for &(price, _, _) in &contributions {
        min_price = min_price.min(price);
        max_price = max_price.max(price);
    }

    // Deterministic width rule: tick-grid anchor, whole-tick width,
    // actual_rows = ceil(span_ticks / width_ticks) <= rows.
    let min_aligned = (min_price / config.tick_size).floor() * config.tick_size;
    let span_ticks =
        (((max_price - min_aligned) / config.tick_size).floor() + Decimal::ONE).max(Decimal::ONE);
    let target_rows = Decimal::from(config.rows as u64);
    let width_ticks = (span_ticks / target_rows).ceil().max(Decimal::ONE);
    let width = width_ticks * config.tick_size;
    let actual_rows = (span_ticks / width_ticks)
        .ceil()
        .to_usize()
        .unwrap_or(1)
        .max(1);
    let mut bins = (0..actual_rows)
        .map(|index| {
            let low = min_aligned + width * Decimal::from(index as u64);
            FixedRangeBin {
                low: price_string(low),
                high: price_string(low + width),
                center: price_string(low + width / Decimal::from(2u64)),
                total: 0,
                bid: 0,
                ask: 0,
            }
        })
        .collect::<Vec<_>>();
    for (price, mode, weight) in contributions {
        let index = (((price - min_aligned) / width)
            .floor()
            .to_usize()
            .unwrap_or(0))
        .min(actual_rows - 1);
        match mode {
            FixedRangeMode::Total => bins[index].total += weight,
            FixedRangeMode::Bid => bins[index].bid += weight,
            FixedRangeMode::Ask => bins[index].ask += weight,
        }
    }

    let total_weights = bins.iter().map(|bin| bin.total).collect::<Vec<_>>();
    let total_weight: u64 = total_weights.iter().sum();
    let bid_weights = bins.iter().map(|bin| bin.bid).collect::<Vec<_>>();
    let ask_weights = bins.iter().map(|bin| bin.ask).collect::<Vec<_>>();
    let (poc, vah, val) = level_strings(&bins, &total_weights, value_area_percent);
    let (bid_poc, bid_vah, bid_val) = level_strings(&bins, &bid_weights, value_area_percent);
    let (ask_poc, ask_vah, ask_val) = level_strings(&bins, &ask_weights, value_area_percent);
    FixedRangeProfile {
        actual_rows: bins.len(),
        rejected_ticks,
        total_weight,
        poc,
        vah,
        val,
        bid_poc,
        bid_vah,
        bid_val,
        ask_poc,
        ask_vah,
        ask_val,
        bins,
    }
}

/// Exact streaming price counts: memory scales with distinct contributing
/// prices rather than the number of historical ticks. No sampling or rebinning.
#[derive(Debug)]
pub struct FixedRangeProfileAccumulator {
    prices: HashMap<Decimal, [u64; 3]>,
    bids: HashSet<Decimal>,
    min_quote: Option<Decimal>,
    max_quote: Option<Decimal>,
    rejected_ticks: u64,
    max_prices: usize,
}

impl FixedRangeProfileAccumulator {
    pub fn new(max_prices: usize) -> Self {
        Self {
            prices: HashMap::new(),
            bids: HashSet::new(),
            min_quote: None,
            max_quote: None,
            rejected_ticks: 0,
            max_prices,
        }
    }

    pub fn price_count(&self) -> usize {
        self.prices.len()
    }

    pub fn merge_price_counts(
        &mut self,
        price: Decimal,
        counts: [u64; 3],
        bid_seen: bool,
    ) -> Result<(), &'static str> {
        let contributes = counts.iter().any(|count| *count > 0);
        if (bid_seen && !self.bids.contains(&price) && self.bids.len() >= self.max_prices)
            || (contributes
                && !self.prices.contains_key(&price)
                && self.prices.len() >= self.max_prices)
        {
            return Err("too many distinct profile prices");
        }
        let old = self.prices.get(&price).copied().unwrap_or_default();
        let mut next = [0; 3];
        for index in 0..3 {
            next[index] = old[index]
                .checked_add(counts[index])
                .ok_or("profile count overflow")?;
        }
        if bid_seen {
            self.bids.insert(price);
        }
        if contributes {
            self.prices.insert(price, next);
        }
        Ok(())
    }

    pub fn merge_quote_range(
        &mut self,
        rejected: u64,
        quotes: Option<(Decimal, Decimal)>,
    ) -> Result<(), &'static str> {
        self.rejected_ticks = self
            .rejected_ticks
            .checked_add(rejected)
            .ok_or("profile count overflow")?;
        if let Some((low, high)) = quotes {
            self.min_quote = Some(self.min_quote.map_or(low, |value| value.min(low)));
            self.max_quote = Some(self.max_quote.map_or(high, |value| value.max(high)));
        }
        Ok(())
    }

    pub fn push(&mut self, tick: &Tick) -> Result<(), &'static str> {
        let valid = tick.bid > Decimal::ZERO && tick.ask > Decimal::ZERO;
        let bid_changed = tick.flags & TICK_FLAG_BID != 0;
        let ask_changed = tick.flags & TICK_FLAG_ASK != 0;
        let flagged = bid_changed || ask_changed;
        let new_bid = !self.bids.contains(&tick.bid);
        let mut extra = usize::from(valid && flagged && !self.prices.contains_key(&tick.bid));
        if valid && ask_changed && tick.ask != tick.bid && !self.prices.contains_key(&tick.ask) {
            extra += 1;
        }
        if (new_bid && self.bids.len() >= self.max_prices)
            || extra > self.max_prices.saturating_sub(self.prices.len())
        {
            return Err("too many distinct profile prices");
        }
        self.bids.insert(tick.bid);
        let low = tick.bid.min(tick.ask);
        let high = tick.bid.max(tick.ask);
        self.min_quote = Some(self.min_quote.map_or(low, |value| value.min(low)));
        self.max_quote = Some(self.max_quote.map_or(high, |value| value.max(high)));
        if !valid {
            self.rejected_ticks = self
                .rejected_ticks
                .checked_add(1)
                .ok_or("profile count overflow")?;
            return Ok(());
        }
        if !flagged {
            return Ok(());
        }
        let bid = self.prices.entry(tick.bid).or_default();
        bid[0] = bid[0].checked_add(1).ok_or("profile count overflow")?;
        if bid_changed {
            bid[1] = bid[1].checked_add(1).ok_or("profile count overflow")?;
        }
        if ask_changed {
            let ask = self.prices.entry(tick.ask).or_default();
            ask[2] = ask[2].checked_add(1).ok_or("profile count overflow")?;
        }
        Ok(())
    }

    /// Matches the historical bid-gap fallback when broker metadata is absent.
    pub fn inferred_tick_size(&self) -> Decimal {
        let mut bids = self.bids.iter().copied().collect::<Vec<_>>();
        bids.sort_unstable();
        if let Some(gap) = bids
            .windows(2)
            .map(|pair| pair[1] - pair[0])
            .filter(|gap| *gap > Decimal::ZERO)
            .min()
        {
            return gap;
        }
        let span = match (self.min_quote, self.max_quote) {
            (Some(low), Some(high)) => high - low,
            _ => Decimal::ZERO,
        };
        if span > Decimal::ZERO {
            span
        } else {
            Decimal::ONE
        }
    }

    pub fn calculate(&self, config: &FixedRangeProfileConfig) -> FixedRangeProfile {
        // Integer counts commute; HashMap iteration order cannot change the
        // aligned bins, lower-price tie breaks or value-area expansion.
        let mut contributions = Vec::with_capacity(self.prices.len() * 3);
        for (&price, counts) in &self.prices {
            for (mode, weight) in [
                (FixedRangeMode::Total, counts[0]),
                (FixedRangeMode::Bid, counts[1]),
                (FixedRangeMode::Ask, counts[2]),
            ] {
                if weight > 0 {
                    contributions.push((price, mode, weight));
                }
            }
        }
        calculate_fixed_range_contributions(config, contributions, self.rejected_ticks)
    }
}
