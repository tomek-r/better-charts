//! The price rows a bar's trades fill: one row per whole number of price ticks, with the volume and
//! the number of trades each side took in it and the number of the row.

use std::cmp::Ordering;
use std::collections::BTreeMap;

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};

use super::{FootprintRow, FootprintTick, Side, TickSide};

/// The largest whole number of ticks a price may sit at: a whole row of the widest width is left above
/// the count, so the bounds of the row a price names stay inside the `i64` tick grid.
const MAX_TICK_COUNT: i64 = i64::MAX - 4_294_967_295;

/// The price rows `ticks` fill, lowest first, each with the volume that traded in it on each side.
///
/// A row spans `ticks_per_row` of the symbol's ticks: row `k` covers the ticks `k * ticks_per_row` up
/// to the ticks of the next row, so the row of a price is its whole tick count divided by the row's
/// width and rounded down.
///
/// The rows are contiguous price levels: every row between the lowest and the highest one the trades
/// reached is here, and a row no trade reached holds no volume on either side. A bar with a gap must
/// not skip the levels between its rows, because an imbalance is measured against the row right below
/// a level and a skipped level would put that row two levels away. A price whose tick count is beyond
/// the tick grid names no row and is dropped rather than rowed on its own.
///
/// A row holds volume only; the number of trades each side took is part of the chart footprint, see
/// [`bar_footprint`](crate::footprint::bar_footprint).
pub fn footprint_rows(
    ticks: &[FootprintTick],
    ticks_per_row: u32,
    mintick: Decimal,
) -> Vec<FootprintRow> {
    numbered_footprint_rows(ticks, ticks_per_row, mintick).rows
}

/// A bar's rows, lowest price first, with the number and the trade counts of each. The rows and their
/// marks are written together, so a row and its mark cannot fall out of step.
#[derive(Default)]
pub(super) struct NumberedRows {
    pub(super) rows: Vec<FootprintRow>,
    pub(super) marks: Vec<RowMark>,
}

impl NumberedRows {
    /// Whether the trades reached no row at all.
    pub(super) fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// The number of the row a summary names by its position among the rows.
    pub(super) fn number_at(&self, index: Option<usize>) -> Option<i64> {
        index.and_then(|index| self.marks.get(index).map(|mark| mark.number))
    }

    /// Write the row `volumes` accumulated with the trades it counted.
    fn push(&mut self, volumes: RowVolumes, width: RowWidth) {
        let (row, mark) = volumes.into_row(width);
        self.rows.push(row);
        self.marks.push(mark);
    }

    /// The number of the highest row written so far.
    fn last_number(&self) -> Option<i64> {
        self.marks.last().map(|mark| mark.number)
    }
}

/// The number of one row and the number of trades each side took in it.
#[derive(Debug, Clone, Copy)]
pub(super) struct RowMark {
    pub(super) number: i64,
    pub(super) trades: RowTrades,
}

/// The number of trades each side of one price row counted: one per tick the trade rule keeps, which is
/// not the row's volume, since a tick of two and a half lots is one trade.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct RowTrades {
    pub(super) buy: u64,
    pub(super) sell: u64,
}

/// The rows of [`footprint_rows`], each with the number of the row it fills.
pub(super) fn numbered_footprint_rows(
    ticks: &[FootprintTick],
    ticks_per_row: u32,
    mintick: Decimal,
) -> NumberedRows {
    let Some(width) = RowWidth::new(ticks_per_row, mintick) else {
        return NumberedRows::default();
    };
    let mut numbered = NumberedRows::default();
    for (number, volumes) in counted_rows(ticks, width) {
        // The counted rows are numbered ascending, so the rows written so far end just below this one
        // and the numbers between them are the levels no trade reached: each gets an empty row, which
        // keeps the rows contiguous price levels (see [`footprint_rows`]).
        if let Some(last) = numbered.last_number() {
            for empty in last.saturating_add(1)..number {
                numbered.push(RowVolumes::empty(empty), width);
            }
        }
        numbered.push(volumes, width);
    }
    numbered
}

/// The volume each price row accumulated, keyed by row number and so ordered by price.
fn counted_rows(ticks: &[FootprintTick], width: RowWidth) -> BTreeMap<i64, RowVolumes> {
    let mut counted = BTreeMap::new();
    // The price and side of the last counted trade are all the tick rule needs from it.
    let mut previous: Option<(Decimal, Side)> = None;
    for tick in traded_ticks(ticks) {
        let Some(row) = width.row_of(tick.price) else {
            continue;
        };
        let side = match tick.side {
            TickSide::Buy => Side::Buy,
            TickSide::Sell => Side::Sell,
            TickSide::Unknown => tick_rule_side(tick.price, previous),
        };
        let volume = trade_volume(tick);
        counted
            .entry(row)
            .or_insert_with(|| RowVolumes::empty(row))
            .add_trade(side, volume);
        previous = Some((tick.price, side));
    }
    counted
}

/// The volume one price row has accumulated, before it becomes a [`FootprintRow`], with the number of
/// trades each side took in it.
struct RowVolumes {
    number: i64,
    buy_volume: Decimal,
    sell_volume: Decimal,
    /// The buy trades counted in the row: one per counted tick, so a trade is a tick and not a lot of
    /// volume.
    buy_trades: u64,
    /// The sell trades counted in the row, by the same rule.
    sell_trades: u64,
}

impl RowVolumes {
    /// The row `number` with no volume and no trade on either side: the row of a price level the bar's
    /// trades did not reach, which keeps the rows contiguous.
    fn empty(number: i64) -> Self {
        Self {
            number,
            buy_volume: Decimal::ZERO,
            sell_volume: Decimal::ZERO,
            buy_trades: 0,
            sell_trades: 0,
        }
    }

    /// Count one trade on `side`: the volume it moved and the one trade it is.
    fn add_trade(&mut self, side: Side, volume: Decimal) {
        match side {
            Side::Buy => {
                self.buy_volume += volume;
                self.buy_trades += 1;
            }
            Side::Sell => {
                self.sell_volume += volume;
                self.sell_trades += 1;
            }
        }
    }

    /// This row with the trades it counted. `up_price` closes the row where the next one starts.
    fn into_row(self, width: RowWidth) -> (FootprintRow, RowMark) {
        let (down_price, up_price) = width.bounds(self.number);
        let row = FootprintRow {
            down_price,
            up_price,
            buy_volume: self.buy_volume,
            sell_volume: self.sell_volume,
        };
        let mark = RowMark {
            number: self.number,
            trades: RowTrades {
                buy: self.buy_trades,
                sell: self.sell_trades,
            },
        };
        (row, mark)
    }
}

/// How wide one price row is: `ticks_per_row` of the symbol's ticks, each `mintick` wide.
#[derive(Clone, Copy)]
struct RowWidth {
    ticks_per_row: u32,
    mintick: Decimal,
}

impl RowWidth {
    /// The width `ticks_per_row` and `mintick` name, or `None` when they name no row: a row needs at
    /// least one whole tick and a positive tick size.
    fn new(ticks_per_row: u32, mintick: Decimal) -> Option<Self> {
        (ticks_per_row > 0 && mintick > Decimal::ZERO).then_some(Self {
            ticks_per_row,
            mintick,
        })
    }

    /// The number of the row `price` falls in, or `None` when its tick count is beyond the tick grid.
    /// The price rounds to the nearest whole tick, so a price between two ticks takes the row of the
    /// nearer one. The division floors, so a price below zero lands in the row below it and not in the
    /// row of the magnitude above.
    fn row_of(self, price: Decimal) -> Option<i64> {
        let nearest = (price / self.mintick)
            .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);
        Some(whole_number_to_i64(nearest)?.div_euclid(i64::from(self.ticks_per_row)))
    }

    /// The prices the row starts and ends at, both from the tick count it covers, so two trades on one
    /// row always read the same prices.
    fn bounds(self, row: i64) -> (Decimal, Decimal) {
        let width = i64::from(self.ticks_per_row);
        let down_ticks = row * width;
        (
            Decimal::from(down_ticks) * self.mintick,
            Decimal::from(down_ticks + width) * self.mintick,
        )
    }
}

/// The `i64` a whole number names, or `None` when the value has a fractional part or lies beyond
/// [`MAX_TICK_COUNT`], where a row could not bound it.
fn whole_number_to_i64(value: Decimal) -> Option<i64> {
    if value.fract() != Decimal::ZERO {
        return None;
    }
    let count = value.to_i64()?;
    (-MAX_TICK_COUNT..=MAX_TICK_COUNT)
        .contains(&count)
        .then_some(count)
}

/// Whether any tick reports a volume. A feed that reports volumes on its trades sends a tick without
/// one as a quote update, which is no trade; a set where no tick reports a volume counts whole ticks as
/// trades instead.
pub(super) fn reports_volume(ticks: &[FootprintTick]) -> bool {
    ticks.iter().any(|tick| tick.volume > Decimal::ZERO)
}

/// The ticks of `ticks` that are trades: every tick counts when no tick of the set reports a volume,
/// where the set counts trades rather than lots; otherwise only the ticks that report a volume count.
fn traded_ticks(ticks: &[FootprintTick]) -> impl Iterator<Item = &FootprintTick> {
    let has_volume = reports_volume(ticks);
    ticks
        .iter()
        .filter(move |tick| !has_volume || tick.volume > Decimal::ZERO)
}

/// A tick's volume: the volume the feed reports, or the one trade it counts as when no tick of its set
/// reports a volume.
fn trade_volume(tick: &FootprintTick) -> Decimal {
    if tick.volume > Decimal::ZERO {
        tick.volume
    } else {
        Decimal::ONE
    }
}

/// The side of a tick that carries no side of its own: the tick rule. A trade above the previous
/// counted trade's price is a buy, below it a sell, and at the same price it takes that trade's side.
/// The first trade of a bar has no price to compare with and counts as a buy.
fn tick_rule_side(price: Decimal, previous: Option<(Decimal, Side)>) -> Side {
    match previous {
        None => Side::Buy,
        Some((previous_price, previous_side)) => match price.cmp(&previous_price) {
            Ordering::Greater => Side::Buy,
            Ordering::Less => Side::Sell,
            Ordering::Equal => previous_side,
        },
    }
}

#[cfg(test)]
#[path = "rows_tests.rs"]
mod tests;
