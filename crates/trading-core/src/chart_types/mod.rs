//! Broker-independent chart types shared by the desktop chart and the Pine
//! engine.
//!
//! A chart type turns broker price bars into the bars a chart draws:
//! [`heikin_ashi`] smooths every bar's open and close, [`line_break`] keeps the
//! closes that start a new line, [`kagi`] joins the closes into lines that turn
//! once a close travels far enough back, [`renko`] stacks one box per move and
//! [`point_figure`] prints columns on a price box grid. All read [`PriceBar`]s
//! and emit [`ChartBar`]s, so one implementation serves every client. Prices stay
//! [`Decimal`] throughout; nothing here converts them to a float, and the only
//! rounding is the one significant figure a computed [`BoxSizing`] takes. A rule
//! a TradingView capture confirms is matched value for value, and the few no
//! capture reaches are marked UNVERIFIED where they live.
//!
//! Chart bars come in the order they formed and their `time_ms` strictly
//! increase. A base bar may produce several chart bars or none; the brick types,
//! which can stack several bricks on one base bar, disambiguate those bricks
//! with one millisecond per extra brick: the first brick takes the base bar's
//! `time_ms` and each further brick of that bar one millisecond more, as
//! TradingView times them.

use rust_decimal::{Decimal, RoundingStrategy};
use thiserror::Error;

use crate::protocol::MarketCandle;

mod heikin_ashi;
mod kagi;
mod line_break;
mod point_figure;
mod renko;

pub use heikin_ashi::heikin_ashi;
pub use kagi::kagi;
pub use line_break::line_break;
pub use point_figure::{point_figure, PointFigureSource};
pub use renko::{renko, renko_with_source, RenkoSource, RenkoWicks};

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
///
/// A chart's bars are in the order they formed and their `time_ms` strictly
/// increase; a brick type puts the several bricks of one base bar a millisecond
/// apart instead of letting them share its time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChartBar {
    pub time_ms: i64,
    pub open: Decimal,
    pub high: Decimal,
    pub low: Decimal,
    pub close: Decimal,
    pub volume: Decimal,
}

/// How a box chart sizes the move that draws its next bar, named the way the
/// chart settings offer it. TradingView's two-argument
/// `ticker.kagi(symbol, reversal)` overload is [`BoxSizing::Traditional`], and
/// `ticker.pointfigure` takes the same three styles as a box of its own.
///
/// A size a chart has to compute — [`BoxSizing::Atr`] and
/// [`BoxSizing::PercentageLtp`] — is rounded to one significant figure, half
/// away from zero, and that one amount is both the box a brick chart draws and
/// the distance a Kagi line turns by. One figure keeps the box short enough to
/// read and steady between history loads whose last bars differ in their last
/// digits, instead of handing the chart a long decimal it would only print.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BoxSizing {
    /// A fixed price distance, the only style a capture has confirmed, used
    /// exactly as given.
    Traditional(Decimal),
    /// Wilder's average true range of `length` bars, read at the last bar and
    /// rounded to one significant figure.
    Atr(u32),
    /// This share of the last close, in percent, rounded to one significant
    /// figure.
    PercentageLtp(Decimal),
}

impl BoxSizing {
    /// The distance a Kagi close has to travel back from the line's extreme to
    /// turn it, sized on the last bar of `bars`.
    ///
    /// `Traditional` is used exactly as given. `Atr` and `PercentageLtp` do what
    /// the settings promise — Wilder's average true range of `length` bars read
    /// at the last bar, and `percent` percent of the last close — rounded to one
    /// significant figure. A series without bars has no close to take a share
    /// of, so it sizes to zero and draws nothing.
    fn amount(&self, bars: &[PriceBar]) -> Result<Decimal, ChartTypeError> {
        let distance = match *self {
            Self::Traditional(distance) => return require_positive(distance, PARAMETER_REVERSAL),
            Self::Atr(length) => wilder_atr(bars, length, TrueRanges::EveryBar)?,
            Self::PercentageLtp(percent) => {
                let percent = require_positive(percent, PARAMETER_PERCENTAGE)?;
                percent_of_close(percent, bars)
            }
        };
        Ok(round_to_one_significant_figure(distance))
    }

    /// The price box the same settings give `bars`: the grid a chart that draws
    /// boxes rounds every price to, which has to be positive. `Atr` and
    /// `PercentageLtp` are rounded to one significant figure, the same amount
    /// Kagi turns a line by. A box chart whose bars cannot fill an ATR window is
    /// told so instead.
    fn box_size(&self, bars: &[PriceBar]) -> Result<Decimal, ChartTypeError> {
        let size = match *self {
            Self::Traditional(size) => size,
            Self::Atr(length) => {
                round_to_one_significant_figure(wilder_atr(bars, length, TrueRanges::BetweenBars)?)
            }
            Self::PercentageLtp(percent) => {
                let close = newest_close(bars).ok_or(ChartTypeError::NotEnoughBars {
                    name: PARAMETER_PERCENTAGE_LTP,
                    required: 1,
                    available: 0,
                })?;
                round_to_one_significant_figure(share_of_close(percent, close))
            }
        };
        if size <= Decimal::ZERO {
            return Err(ChartTypeError::NonPositiveParameter {
                name: PARAMETER_BOX_SIZE,
            });
        }
        Ok(size)
    }
}

/// Reported in [`ChartTypeError::NonPositiveParameter`] for a reversal distance
/// that could never turn a line.
const PARAMETER_REVERSAL: &str = "reversal";

/// Reported in [`ChartTypeError::NonPositiveParameter`] for an ATR window and in
/// [`ChartTypeError::NotEnoughBars`] for one the bars cannot fill.
const PARAMETER_ATR_LENGTH: &str = "atr_length";

/// Reported in [`ChartTypeError::NonPositiveParameter`] for a percentage.
const PARAMETER_PERCENTAGE: &str = "percentage";

/// Reported in [`ChartTypeError::NotEnoughBars`] for a percentage box with no
/// close to read.
const PARAMETER_PERCENTAGE_LTP: &str = "percentage_ltp";

/// Reported in [`ChartTypeError::NonPositiveParameter`] when the box that comes
/// out of the sizing is not positive.
const PARAMETER_BOX_SIZE: &str = "box_size";

/// A percentage setting arrives as the number itself, so 1 is one percent.
const PERCENT_DIVISOR: u32 = 100;

/// Why a chart type refused its input.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ChartTypeError {
    #[error("invalid decimal {field} price")]
    InvalidPrice { field: &'static str },
    #[error("bar times are not strictly increasing")]
    TimesNotIncreasing,
    #[error("{name} must be positive")]
    NonPositiveParameter { name: &'static str },
    #[error("{name} needs at least {required} bars, got {available}")]
    NotEnoughBars {
        name: &'static str,
        required: usize,
        available: usize,
    },
    #[error("the {name} source is not supported")]
    UnsupportedSource { name: &'static str },
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

/// The bar a chart type draws between an opening and a closing price: it knows
/// no other prices, so the two ends are its high and low, and the caller fills
/// in the volume of the bars it covers.
fn bar_between(time_ms: i64, open: Decimal, close: Decimal) -> ChartBar {
    ChartBar {
        time_ms,
        open,
        high: open.max(close),
        low: open.min(close),
        close,
        volume: Decimal::ZERO,
    }
}

/// The distance a sizing asks for, or the error naming the setting that has to
/// be positive.
fn require_positive(value: Decimal, name: &'static str) -> Result<Decimal, ChartTypeError> {
    if value <= Decimal::ZERO {
        return Err(ChartTypeError::NonPositiveParameter { name });
    }
    Ok(value)
}

/// The newest close, which a [`BoxSizing::PercentageLtp`] is a share of. A
/// series without bars has no close.
fn newest_close(bars: &[PriceBar]) -> Option<Decimal> {
    bars.last().map(|bar| bar.close)
}

/// `percent` percent of the newest close, the distance a
/// [`BoxSizing::PercentageLtp`] asks for before it is rounded. A series without
/// bars has no close, so the distance is zero.
fn percent_of_close(percent: Decimal, bars: &[PriceBar]) -> Decimal {
    match newest_close(bars) {
        Some(close) => share_of_close(percent, close),
        None => Decimal::ZERO,
    }
}

/// `percent` percent of `close`, the share a [`BoxSizing::PercentageLtp`] takes.
fn share_of_close(percent: Decimal, close: Decimal) -> Decimal {
    percent * close / Decimal::from(PERCENT_DIVISOR)
}

/// `amount` rounded to one significant figure, half away from zero: the one
/// figure a [`BoxSizing::Atr`] or [`BoxSizing::PercentageLtp`] sizes a chart
/// with (6999.27 -> 7000, 8194.97 -> 8000, 0.00095 -> 0.001). A zero stays
/// zero, and a positive amount never rounds down to it, because the figure
/// keeps the place it stood in.
fn round_to_one_significant_figure(amount: Decimal) -> Decimal {
    if amount.is_zero() {
        return amount;
    }
    // Move the leading digit into the units place, where rounding to a whole
    // number rounds the whole amount down to that one figure.
    let mut scaled = amount;
    // The number of places the leading digit moved, and so the power of ten the
    // figure has to be shifted back by; how far it can move is bounded by a
    // decimal's scale, well inside an `i32`.
    let mut places: i32 = 0;
    while scaled.abs() >= Decimal::TEN {
        scaled /= Decimal::TEN;
        places += 1;
    }
    while scaled.abs() < Decimal::ONE {
        scaled *= Decimal::TEN;
        places -= 1;
    }
    // A nine that rounds up to ten carries into the place above, as 950 does
    // into 1000.
    let mut figure = scaled.round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);
    // Put the figure back where it came from.
    for _ in 0..places.unsigned_abs() {
        figure = if places > 0 {
            figure * Decimal::TEN
        } else {
            figure / Decimal::TEN
        };
    }
    figure
}

/// Which bars a Wilder average reads a true range from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TrueRanges {
    /// Every bar's, the first one measuring its own high-to-low span in place of
    /// a missing gap: the series Kagi's reversal distance reads.
    EveryBar,
    /// The gaps between bars, the series a box chart seeds the box it draws
    /// with, so measuring `length` ranges takes one bar more than they do.
    BetweenBars,
}

impl TrueRanges {
    /// The true ranges `bars` give this reading, one per range it measures.
    fn of(self, bars: &[PriceBar]) -> Vec<Decimal> {
        let mut previous_close: Option<Decimal> = None;
        let mut ranges = Vec::with_capacity(bars.len());
        for bar in bars {
            if previous_close.is_some() || matches!(self, Self::EveryBar) {
                ranges.push(true_range(bar, previous_close));
            }
            previous_close = Some(bar.close);
        }
        ranges
    }
}

/// One bar's true range: its own high-to-low span, widened by the gaps to the
/// close before it once there is one.
fn true_range(bar: &PriceBar, previous_close: Option<Decimal>) -> Decimal {
    let span = bar.high - bar.low;
    let Some(close) = previous_close else {
        return span;
    };
    let gap_up = (bar.high - close).abs();
    let gap_down = (bar.low - close).abs();
    span.max(gap_up).max(gap_down)
}

/// Wilder's average true range read at the last bar, over the true ranges
/// `ranges` says it measures.
///
/// A box chart reads the gaps between bars, so a window of `length` ranges needs
/// one bar more than it and a series that cannot fill it is refused. Kagi's
/// reversal distance reads every bar and averages the ranges it has. A zero
/// window is no window at all and is refused too.
fn wilder_atr(
    bars: &[PriceBar],
    length: u32,
    ranges: TrueRanges,
) -> Result<Decimal, ChartTypeError> {
    if length == 0 {
        return Err(ChartTypeError::NonPositiveParameter {
            name: PARAMETER_ATR_LENGTH,
        });
    }
    let window = usize::try_from(length).unwrap_or(usize::MAX);
    if matches!(ranges, TrueRanges::BetweenBars) && bars.len() <= window {
        return Err(ChartTypeError::NotEnoughBars {
            name: PARAMETER_ATR_LENGTH,
            required: window.saturating_add(1),
            available: bars.len(),
        });
    }
    Ok(wilder_average(&ranges.of(bars), length))
}

/// The mean of the first `length` true ranges, then every later one smoothed in
/// by `(previous * (length - 1) + range) / length`; a shorter series averages
/// the ranges it has.
fn wilder_average(ranges: &[Decimal], length: u32) -> Decimal {
    let window = Decimal::from(length.max(1));
    let mut average = Decimal::ZERO;
    let mut counted = Decimal::ZERO;
    for range in ranges {
        average = if counted < window {
            counted += Decimal::ONE;
            average + (*range - average) / counted
        } else {
            (average * (window - Decimal::ONE) + *range) / window
        };
    }
    average
}

#[cfg(test)]
#[path = "box_sizing_tests.rs"]
mod box_sizing_tests;

#[cfg(test)]
#[path = "price_bar_tests.rs"]
mod tests;
