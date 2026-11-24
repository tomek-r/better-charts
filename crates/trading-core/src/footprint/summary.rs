//! The summary of a footprint's rows: the aggregate volume each side moved, the point of control, the
//! value area and the per-row imbalance flags.

use rust_decimal::Decimal;

use super::FootprintRow;

/// The summary of a footprint's rows.
///
/// Row indices refer to the rows passed to [`summarize_footprint`], which are ordered lowest price
/// first and are adjacent price rows: every row between a bar's lowest and highest traded price is
/// present, empty ones included. A footprint without rows has no point of control and no value area.
///
/// The imbalance rule: a row's buy volume is at least `imbalance_percent` percent of the sell volume of
/// the row below it, and a row's sell volume is at least that percent of the buy volume of the row
/// above it. The imbalanced side must itself be positive, so an empty level is never an imbalance; the
/// opposite side may be zero.
#[derive(Debug, Clone, PartialEq)]
pub struct FootprintSummary {
    /// Total volume traded into the ask, summed over all rows.
    pub buy_volume: Decimal,
    /// Total volume traded into the bid, summed over all rows.
    pub sell_volume: Decimal,
    /// The row with the highest total volume; on a tie, the last such row.
    pub poc: Option<usize>,
    /// The lowest-price row of the value area.
    pub val: Option<usize>,
    /// The highest-price row of the value area.
    pub vah: Option<usize>,
    /// Per-row buy imbalance flag, parallel to the rows: the row's buy volume is positive and reaches
    /// `imbalance_percent` of the sell volume of the row below it. That sell volume may be zero, but a
    /// row with no buy volume is never flagged.
    pub buy_imbalance: Vec<bool>,
    /// Per-row sell imbalance flag, parallel to the rows: the row's sell volume is positive and reaches
    /// `imbalance_percent` of the buy volume of the row above it. That buy volume may be zero, but a row
    /// with no sell volume is never flagged.
    pub sell_imbalance: Vec<bool>,
}

impl FootprintSummary {
    /// The net volume the buying side moved over the selling side: buy minus sell, positive when buyers
    /// were the aggressors.
    pub fn delta(&self) -> Decimal {
        self.buy_volume - self.sell_volume
    }
}

/// Whether `side` reaches `percent` of `other`. The comparison stays in percent units instead of
/// dividing the percentage by a hundred, so it is exact: `side * 100 >= other * percent` is the same
/// test as `side >= other * percent / 100` without the rounding of the division.
fn at_least_percent_of(side: Decimal, other: Decimal, percent: Decimal) -> bool {
    side * Decimal::from(100) >= other * percent
}

/// Whether a row's buy volume is imbalanced against the sell volume of the row below it. The buy side
/// must itself be positive; `sell_below` is `None` for the lowest row, which has nothing below it.
fn buy_pressure(buy_volume: Decimal, sell_below: Option<Decimal>, percent: Decimal) -> bool {
    buy_volume > Decimal::ZERO
        && sell_below.is_some_and(|sell| at_least_percent_of(buy_volume, sell, percent))
}

/// Whether a row's sell volume is imbalanced against the buy volume of the row above it, by the rule of
/// [`buy_pressure`]: `buy_above` is `None` for the highest row.
fn sell_pressure(sell_volume: Decimal, buy_above: Option<Decimal>, percent: Decimal) -> bool {
    sell_volume > Decimal::ZERO
        && buy_above.is_some_and(|buy| at_least_percent_of(sell_volume, buy, percent))
}

/// The value-area bounds `(val, vah)`: expand from the POC row, always taking the higher-volume
/// neighbour (a tie goes below), until `percent` of the rows' total volume is covered.
fn value_area(
    rows: &[FootprintRow],
    poc: usize,
    total: Decimal,
    percent: Decimal,
) -> (usize, usize) {
    let mut covered = rows[poc].total_volume();
    let (mut low, mut high) = (poc, poc);
    while !at_least_percent_of(covered, total, percent) && (low > 0 || high + 1 < rows.len()) {
        let below = low.checked_sub(1).map(|index| rows[index].total_volume());
        let above = rows.get(high + 1).map(|row| row.total_volume());
        match (below, above) {
            // The higher-volume neighbour joins the area; a tie goes to the lower-priced side.
            (Some(below_volume), Some(above_volume)) if below_volume >= above_volume => {
                low -= 1;
                covered += below_volume;
            }
            // Otherwise the neighbour above joins; at a range edge only the available side can.
            (_, Some(above_volume)) => {
                high += 1;
                covered += above_volume;
            }
            (Some(below_volume), None) => {
                low -= 1;
                covered += below_volume;
            }
            (None, None) => break,
        }
    }
    (low, high)
}

/// Summarize the footprint `rows` (lowest price first, adjacent price rows with empty ones included):
/// the aggregate buy and sell volume, the POC and value-area rows covering `va_percent` of the total
/// volume, and the per-row buy and sell imbalance flags of `imbalance_percent`.
///
/// Both percentages are given in percent: `70` is 70%.
pub fn summarize_footprint(
    rows: &[FootprintRow],
    va_percent: Decimal,
    imbalance_percent: Decimal,
) -> FootprintSummary {
    let mut buy_imbalance = Vec::with_capacity(rows.len());
    let mut sell_imbalance = Vec::with_capacity(rows.len());
    for (index, row) in rows.iter().enumerate() {
        // A buy imbalance measures against the sell volume of the row below, a sell imbalance against
        // the buy volume of the row above. The opposite side may be zero, but the imbalanced side
        // itself must be positive: otherwise 0 >= ratio * 0 would flag every empty level.
        let sell_below = index.checked_sub(1).map(|below| rows[below].sell_volume);
        let buy_above = rows.get(index + 1).map(|above| above.buy_volume);
        buy_imbalance.push(buy_pressure(row.buy_volume, sell_below, imbalance_percent));
        sell_imbalance.push(sell_pressure(row.sell_volume, buy_above, imbalance_percent));
    }

    let buy_volume: Decimal = rows.iter().map(|row| row.buy_volume).sum();
    let sell_volume: Decimal = rows.iter().map(|row| row.sell_volume).sum();
    let total = buy_volume + sell_volume;

    let poc = rows
        .iter()
        .enumerate()
        .max_by_key(|(_, row)| row.total_volume())
        .map(|(index, _)| index);
    let (val, vah) = match poc {
        Some(poc) => {
            let (low, high) = value_area(rows, poc, total, va_percent);
            (Some(low), Some(high))
        }
        None => (None, None),
    };

    FootprintSummary {
        buy_volume,
        sell_volume,
        poc,
        val,
        vah,
        buy_imbalance,
        sell_imbalance,
    }
}

#[cfg(test)]
#[path = "summary_tests.rs"]
mod tests;
