//! One chart bar's footprint: the rows its trades fill, the volume and the trades each side took in
//! them, and the summary those rows produce, with the point of control and the value area named by row
//! number rather than by an index into the rows, so a host that later loads a different set of ticks
//! for the bar can still tell which row the summary pointed at.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use super::rows::{numbered_footprint_rows, reports_volume};
use super::summary::summarize_footprint;
use super::FootprintTick;

/// Where a bar's row volumes come from: the lots the feed reports, or the trades it counts when it
/// reports no volume at all.
///
/// A feed reports a volume on the ticks of an instrument that has one, and none on the ticks of an
/// instrument that does not. A tick without a volume on an instrument that has them is a quote update,
/// not a trade. A bar normally holds one kind of tick, but a bar can mix the two, so the rule is: only
/// a bar whose every tick reports no volume is [`FootprintVolume::Ticks`], where each tick counts as
/// one trade; a bar with a volume on any tick is [`FootprintVolume::Real`], where only the ticks that
/// report a volume count and the volume-less ones are left out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FootprintVolume {
    Real,
    Ticks,
}

impl FootprintVolume {
    /// The kind of volume `ticks` carry.
    fn of(ticks: &[FootprintTick]) -> Self {
        if reports_volume(ticks) {
            Self::Real
        } else {
            Self::Ticks
        }
    }
}

/// One price row of a bar's footprint: the row's number, the price range it spans, the volume that
/// traded on each side in it, the number of trades each side took in it, and the imbalances the summary
/// found in it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartFootprintRow {
    /// The row's number: the row of the ticks `row * ticks_per_row` up to the next row's, negative
    /// below price zero.
    pub row: i64,
    /// The row's lower price bound, inclusive.
    pub down_price: Decimal,
    /// The row's upper price bound, exclusive.
    pub up_price: Decimal,
    /// The volume that traded into the ask.
    pub buy_volume: Decimal,
    /// The volume that traded into the bid.
    pub sell_volume: Decimal,
    /// The number of buy trades the row counted: one per tick of the bar the trade rule keeps, so a
    /// trade is a tick and not a lot of volume.
    pub buy_trades: u64,
    /// The number of sell trades the row counted, by the same rule.
    pub sell_trades: u64,
    /// Whether the row's buy volume is imbalanced against the row below.
    pub buy_imbalance: bool,
    /// Whether the row's sell volume is imbalanced against the row above.
    pub sell_imbalance: bool,
}

/// The footprint of one bar: the rows of its price levels, contiguous from the lowest the bar reached to
/// the highest, and the summary of them, with the POC and the value area named by row number rather than
/// by index into `rows`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BarFootprint {
    /// The bar's opening time, UNIX milliseconds, as the caller gave it.
    pub open_ms: i64,
    /// The bar's rows, lowest price first: one row per price level from the lowest the bar reached to
    /// the highest, so a level no trade reached holds no volume on either side.
    pub rows: Vec<ChartFootprintRow>,
    /// Total volume traded into the ask, summed over all rows.
    pub buy_volume: Decimal,
    /// Total volume traded into the bid, summed over all rows.
    pub sell_volume: Decimal,
    /// The number of buy trades the bar counted, the sum of its rows' buy trades.
    pub buy_trades: u64,
    /// The number of sell trades the bar counted, the sum of its rows' sell trades.
    pub sell_trades: u64,
    /// The row with the largest total volume, as a row number.
    pub poc: Option<i64>,
    /// The highest row of the value area, as a row number.
    pub vah: Option<i64>,
    /// The lowest row of the value area, as a row number.
    pub val: Option<i64>,
    /// Where the bar's row volumes come from.
    pub volume: FootprintVolume,
}

/// How a bar's footprint is split into rows and summarised: the width of a row in ticks, and the two
/// percentages the summary reads.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FootprintSettings {
    /// The number of the symbol's ticks one row spans.
    pub ticks_per_row: u32,
    /// The share of the bar's volume the value area must cover, in percent.
    pub va_percent: Decimal,
    /// The share of the opposite side of the adjacent row an imbalance must reach, in percent.
    pub imbalance_percent: Decimal,
}

/// The footprint of the bar that opened at `open_ms`: its rows, the volume each side traded in them,
/// the number of trades each side took in them, and the POC and the value area the summary reports for
/// them.
///
/// A trade is one tick the footprint counts: a tick of two and a half lots is one trade, so a row's
/// trade count is the ticks behind its volume and not the volume itself.
///
/// `None` when the bar has no tick this model can row: no trades at all, a tick size or a row width that
/// names no row, or every price beyond the tick grid.
pub fn bar_footprint(
    open_ms: i64,
    ticks: &[FootprintTick],
    mintick: Decimal,
    settings: &FootprintSettings,
) -> Option<BarFootprint> {
    let numbered = numbered_footprint_rows(ticks, settings.ticks_per_row, mintick);
    if numbered.is_empty() {
        return None;
    }
    let va_percent = settings.va_percent;
    let imbalance_percent = settings.imbalance_percent;
    let summary = summarize_footprint(&numbered.rows, va_percent, imbalance_percent);
    let mut rows: Vec<ChartFootprintRow> = Vec::with_capacity(numbered.rows.len());
    for (index, (row, mark)) in numbered.rows.iter().zip(&numbered.marks).enumerate() {
        rows.push(ChartFootprintRow {
            row: mark.number,
            down_price: row.down_price,
            up_price: row.up_price,
            buy_volume: row.buy_volume,
            sell_volume: row.sell_volume,
            buy_trades: mark.trades.buy,
            sell_trades: mark.trades.sell,
            buy_imbalance: flagged(&summary.buy_imbalance, index),
            sell_imbalance: flagged(&summary.sell_imbalance, index),
        });
    }
    // The bar's trade counts are the sum over its rows: a bar's ticks are bounded by the read that
    // collected them, far inside `u64`, and the empty rows between traded ones add nothing.
    let buy_trades: u64 = rows.iter().map(|row| row.buy_trades).sum();
    let sell_trades: u64 = rows.iter().map(|row| row.sell_trades).sum();
    Some(BarFootprint {
        open_ms,
        rows,
        buy_volume: summary.buy_volume,
        sell_volume: summary.sell_volume,
        buy_trades,
        sell_trades,
        poc: numbered.number_at(summary.poc),
        vah: numbered.number_at(summary.vah),
        val: numbered.number_at(summary.val),
        volume: FootprintVolume::of(ticks),
    })
}

/// Whether the summary flagged the row at `index`: it carries one flag per row, and a row it does not
/// name has no imbalance.
fn flagged(flags: &[bool], index: usize) -> bool {
    flags.get(index).copied().unwrap_or(false)
}

#[cfg(test)]
#[path = "chart_tests.rs"]
mod tests;
