//! Volume footprint: one bar's trades split into equal price rows, and the summary of those rows.
//!
//! A volume footprint splits a bar's traded volume into equally sized price rows and sums the volume
//! that traded upward (`buy`, into the ask) and downward (`sell`, into the bid) in each one.
//! [`bar_footprint`] turns one bar's ticks into the rows a chart draws, [`footprint_rows`] gives the
//! rows alone, and [`summarize_footprint`] gives the point of control, the value area and the
//! imbalance flags of a list of rows. [`stacked_imbalance_zones`] groups the flagged rows into the
//! price zones a chart shades.
//!
//! # Which ticks count, and on which side
//!
//! A feed reports its trades as ticks, and this model reads two things from them:
//!
//! * **Which ticks are trades.** On a feed whose ticks carry a volume, a tick without one is a quote
//!   update: it moves no volume, takes no side and hands the tick rule no price to compare with. On a
//!   feed where no tick carries a volume (as a forex feed has it), every tick counts as one trade.
//!   [`FootprintVolume`] reports which of the two a bar's rows were built from.
//! * **Which side a trade took.** The side the feed flagged, or — for [`TickSide::Unknown`] — the side
//!   the tick rule gives it: a trade above the previous counted trade's price is a buy, below it a
//!   sell, and at the same price it takes that trade's side. The first trade of a bar counts as a buy.
//!
//! A trade is one tick whatever volume it moved, so a row's trade counts are the ticks behind its
//! volume and not the volume itself: a tick of two and a half lots is one trade.
//!
//! # Rows
//!
//! A row is `ticks_per_row` whole ticks of the symbol wide, so its prices are whole multiples of the
//! minimum tick and two trades in one row never disagree about where it starts. Rows are contiguous
//! price levels: every level between the lowest and the highest row a bar's trades reached is a row of
//! its own, and a level no trade reached holds nothing on either side. A skipped level would put the
//! row an imbalance compares against two levels away, and a chart draws every level between the bar's
//! low and its high.

mod chart;
mod rows;
mod stacked;
mod summary;

pub use chart::{bar_footprint, BarFootprint, ChartFootprintRow};
pub use chart::{FootprintSettings, FootprintVolume};
pub use rows::footprint_rows;
pub use stacked::{stacked_imbalance_zones, ImbalanceZone};
pub use summary::{summarize_footprint, FootprintSummary};

use rust_decimal::Decimal;
use serde::Serialize;

/// MT5's `TICK_FLAG_BUY`: the tick is a buy deal.
pub const TICK_FLAG_BUY: u32 = 32;
/// MT5's `TICK_FLAG_SELL`: the tick is a sell deal.
pub const TICK_FLAG_SELL: u32 = 64;

/// The side a tick reports: the direction of the trade the feed flagged, or [`TickSide::Unknown`]
/// when it flagged none, which the tick rule then decides.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TickSide {
    Buy,
    Sell,
    Unknown,
}

impl TickSide {
    /// The side MT5's tick flags name. A tick that carries neither [`TICK_FLAG_BUY`] nor
    /// [`TICK_FLAG_SELL`] has no side of its own; one that somehow carries both counts as a buy.
    pub fn from_flags(flags: u32) -> Self {
        if flags & TICK_FLAG_BUY != 0 {
            Self::Buy
        } else if flags & TICK_FLAG_SELL != 0 {
            Self::Sell
        } else {
            Self::Unknown
        }
    }
}

/// A side that has been decided: the side a trade took, or the side a stacked imbalance sits on. A
/// tick may also report no side of its own — see [`TickSide`] — but a decided side is always one of
/// the two.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    Buy,
    Sell,
}

/// One trade of a bar, as the feed reports it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FootprintTick {
    /// The trade's time, UNIX milliseconds.
    pub time_ms: i64,
    /// The last traded price.
    pub price: Decimal,
    /// The volume the trade moved, or `0` when the feed reports none: a set of such ticks counts
    /// whole trades instead of lots.
    pub volume: Decimal,
    /// The side the feed flagged, or [`TickSide::Unknown`] when it flagged none.
    pub side: TickSide,
}

impl FootprintTick {
    /// The tick the feed reports with `flags`: the side the flags name, or none when they name none.
    pub fn from_flags(time_ms: i64, price: Decimal, volume: Decimal, flags: u32) -> Self {
        Self {
            time_ms,
            price,
            volume,
            side: TickSide::from_flags(flags),
        }
    }
}

/// One price row of a footprint: the price range it spans and the volume that traded into the bid
/// (`sell`) and the ask (`buy`) in it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FootprintRow {
    /// The row's lower price bound, inclusive.
    pub down_price: Decimal,
    /// The row's upper price bound, exclusive: the row above starts here.
    pub up_price: Decimal,
    /// The volume that traded into the ask.
    pub buy_volume: Decimal,
    /// The volume that traded into the bid.
    pub sell_volume: Decimal,
}

impl FootprintRow {
    /// The volume traded in the row on both sides.
    pub fn total_volume(&self) -> Decimal {
        self.buy_volume + self.sell_volume
    }
}
