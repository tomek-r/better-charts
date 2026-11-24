//! Stacked imbalance zones: runs of adjacent rows the imbalance rule flags on one side, which a chart
//! draws as one price zone.

use rust_decimal::Decimal;
use serde::Serialize;

use super::chart::ChartFootprintRow;
use super::Side;

/// One zone of stacked imbalance: a run of adjacent rows the imbalance rule flags on the same side, so
/// the imbalance stacks over a contiguous price range instead of sitting on a single level.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImbalanceZone {
    /// The side the rows are imbalanced on.
    pub side: Side,
    /// The number of the zone's lowest row.
    pub low_row: i64,
    /// The number of the zone's highest row.
    pub high_row: i64,
    /// The zone's lower price bound: the bottom of its lowest row.
    pub down_price: Decimal,
    /// The zone's upper price bound: the top of its highest row.
    pub up_price: Decimal,
    /// The number of rows the zone stacks.
    pub row_count: usize,
}

/// The stacked imbalance zones of `rows` (lowest price first, with adjacent row numbers): one zone per
/// run of at least `minimum_rows` consecutive rows flagged on the same side, lowest first.
///
/// A stack is what the imbalance rule leaves behind when it keeps flagging one side from row to row: a
/// buy stack is a run of rows whose buy volume overpowers the sell volume below, a sell stack a run
/// whose sell volume overpowers the buy volume above. A row the rule does not flag ends a run, and so
/// does a jump in row numbers, since a zone is a contiguous price range. A row flagged on both sides
/// joins neither stack, because a stack sits on one side only, so such a row ends the runs around it.
/// `minimum_rows` below one counts as one, and every flagged row is then a zone of its own.
pub fn stacked_imbalance_zones(
    rows: &[ChartFootprintRow],
    minimum_rows: usize,
) -> Vec<ImbalanceZone> {
    let minimum_rows = minimum_rows.max(1);
    let mut zones = Vec::new();
    let mut start = 0;
    while let Some(first) = rows.get(start) {
        let side = zone_side(first);
        let mut end = start + 1;
        while let (Some(row), Some(previous)) = (rows.get(end), rows.get(end - 1)) {
            let continues = zone_side(row) == side && previous.row.saturating_add(1) == row.row;
            if !continues {
                break;
            }
            end += 1;
        }
        if let Some(side) = side.filter(|_| end - start >= minimum_rows) {
            let high = rows.get(end - 1).unwrap_or(first);
            zones.push(ImbalanceZone {
                side,
                low_row: first.row,
                high_row: high.row,
                down_price: first.down_price,
                up_price: high.up_price,
                row_count: end - start,
            });
        }
        start = end;
    }
    zones
}

/// The side a row is imbalanced on: its buy flag, its sell flag, or neither. A row flagged on both
/// sides has no single side to stack.
fn zone_side(row: &ChartFootprintRow) -> Option<Side> {
    match (row.buy_imbalance, row.sell_imbalance) {
        (true, false) => Some(Side::Buy),
        (false, true) => Some(Side::Sell),
        _ => None,
    }
}

#[cfg(test)]
#[path = "stacked_tests.rs"]
mod tests;
