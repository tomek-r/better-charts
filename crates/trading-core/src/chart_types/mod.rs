//! Broker-independent chart types shared by the desktop chart and the Pine
//! engine.
//!
//! A chart type turns broker price bars into the bars a chart draws:
//! [`heikin_ashi`] smooths every bar's open and close, [`line_break`] keeps the
//! closes that start a new line. Both read [`PriceBar`]s and emit [`ChartBar`]s,
//! so one implementation serves every client, and both match TradingView value
//! for value. Prices stay [`Decimal`] throughout; nothing here rounds or
//! converts them to a float.
//!
//! Chart bars come in the order they formed: a base bar may produce several
//! (they then share its `time_ms`) or none. Renko, Kagi and Point & Figure
//! belong in this module too.

use rust_decimal::Decimal;
use thiserror::Error;

use crate::protocol::MarketCandle;

mod heikin_ashi;
mod line_break;

pub use heikin_ashi::heikin_ashi;
pub use line_break::line_break;

/// A broker price bar that chart types read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PriceBar {
    pub time_ms: i64,
    pub open: Decimal,
    pub high: Decimal,
    pub low: Decimal,
    pub close: Decimal,
    /// Traded volume: the broker's real volume when it reports one, its tick
    /// volume otherwise.
    pub volume: Decimal,
}

impl PriceBar {
    /// Converts one broker candle. Wire prices are decimal strings and stay
    /// decimal; a price that does not parse fails the conversion instead of
    /// defaulting, so a chart never draws a price the broker did not send.
    pub fn from_market_candle(candle: &MarketCandle) -> Result<Self, ChartTypeError> {
        Ok(Self {
            time_ms: candle.time_ms,
            open: parse_price(&candle.open, "open")?,
            high: parse_price(&candle.high, "high")?,
            low: parse_price(&candle.low, "low")?,
            close: parse_price(&candle.close, "close")?,
            volume: Decimal::from(traded_volume(candle)),
        })
    }
}

/// A bar a chart type draws.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChartBar {
    pub time_ms: i64,
    pub open: Decimal,
    pub high: Decimal,
    pub low: Decimal,
    pub close: Decimal,
    pub volume: Decimal,
}

/// Why a chart type refused its input.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ChartTypeError {
    #[error("invalid decimal {field} price")]
    InvalidPrice { field: &'static str },
    #[error("bar times are not strictly increasing")]
    TimesNotIncreasing,
    #[error("{name} must be positive")]
    NonPositiveParameter { name: &'static str },
}

fn traded_volume(candle: &MarketCandle) -> u64 {
    if candle.real_volume > 0 {
        candle.real_volume
    } else {
        candle.tick_volume
    }
}

fn parse_price(value: &str, field: &'static str) -> Result<Decimal, ChartTypeError> {
    value
        .parse()
        .map_err(|_| ChartTypeError::InvalidPrice { field })
}

/// Chart types that compare neighbouring bars need them in the broker's order.
fn check_increasing_times(bars: &[PriceBar]) -> Result<(), ChartTypeError> {
    if bars
        .windows(2)
        .any(|pair| pair[0].time_ms >= pair[1].time_ms)
    {
        return Err(ChartTypeError::TimesNotIncreasing);
    }
    Ok(())
}

#[cfg(test)]
#[path = "price_bar_tests.rs"]
mod tests;
