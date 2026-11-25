//! The chart footprint the host publishes for the chart's own bars: the rows, POC and value area of
//! every bar whose ticks a read took whole, and the forming bar's as it forms.
//!
//! The chart asks for one with `set_chart_footprint` and hears back on `chart-footprint` for the
//! loaded window and `chart-footprint-forming` for the forming bar (see the `events` module). Nothing
//! is published while the chart footprint is off.
//!
//! A row is a whole number of the symbol's ticks. The chart names that number itself, or asks for the
//! automatic one, which the host resolves from the window it just loaded and never from a live tick,
//! so the rows do not move while the chart reads them.

mod commands;
pub(crate) mod events;

#[cfg(test)]
mod tests;

pub(crate) use commands::set_chart_footprint;
pub(crate) use events::{footprint_chart, mintick_of, publish_forming, publish_window};

use crate::bridge::accept::read_footprint_ticks;
use crate::bridge::state::BridgeState;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};
use serde::Deserialize;
use std::sync::MutexGuard;
use trading_core::footprint::FootprintSettings;
use trading_core::protocol::MarketCandle;

/// The share of the window's average true range one automatic row spans, in percent: a charting
/// platform documents its automatic row size as `0.2 * NormalizedATR` and leaves the normalization
/// undocumented, and this host reads it as that ATR measured in the symbol's own ticks.
const AUTO_ROW_ATR_SHARE_PERCENT: u32 = 20;
/// The narrowest row a request may name, and the narrowest an automatic size resolves to.
const MIN_TICKS_PER_ROW: u32 = 1;
/// The ATR lengths a request may ask an automatic row size to average over, in bars.
const MIN_ATR_LENGTH: u32 = 1;
const MAX_ATR_LENGTH: u32 = 500;

/// What the chart asked the host to publish: how wide a row is, and the two percentages the engine
/// reads for the value area and the imbalances.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartFootprintRequest {
    pub(crate) row_size: ChartFootprintRowSize,
    #[serde(deserialize_with = "deserialize_percent")]
    pub(crate) va_percent: Decimal,
    #[serde(deserialize_with = "deserialize_percent")]
    pub(crate) imbalance_percent: Decimal,
}

/// How the chart names a row's width: a number of the symbol's ticks, or the automatic width the host
/// resolves from the loaded window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum ChartFootprintRowSize {
    /// `0.2 * ATR(atrLength)` in the symbol's ticks, at least one tick.
    Auto {
        #[serde(rename = "atrLength")]
        atr_length: u32,
    },
    /// The chart's own width, in ticks.
    Manual {
        #[serde(rename = "ticksPerRow")]
        ticks_per_row: u32,
    },
}

impl ChartFootprintRequest {
    /// Why this request names no footprint, or `Ok` when it does. Every bound is checked here, at the
    /// boundary the frontend writes to, so the emit path trusts the settings it reads.
    pub(crate) fn validate(&self) -> Result<(), &'static str> {
        self.row_size.validate()?;
        if !is_percentage(self.va_percent) {
            return Err("vaPercent must be greater than 0 and at most 100");
        }
        if self.imbalance_percent <= Decimal::ZERO {
            return Err("imbalancePercent must be greater than 0");
        }
        Ok(())
    }
}

impl ChartFootprintRowSize {
    /// Why this row width names no row, or `Ok` when it does.
    fn validate(&self) -> Result<(), &'static str> {
        match *self {
            Self::Auto { atr_length } => {
                if (MIN_ATR_LENGTH..=MAX_ATR_LENGTH).contains(&atr_length) {
                    Ok(())
                } else {
                    Err("atrLength must be between 1 and 500")
                }
            }
            Self::Manual { ticks_per_row } => {
                if ticks_per_row < MIN_TICKS_PER_ROW {
                    Err("ticksPerRow must be at least 1")
                } else {
                    Ok(())
                }
            }
        }
    }
}

/// Whether `value` is a value area percentage the engine can read: above zero, at most 100.
fn is_percentage(value: Decimal) -> bool {
    value > Decimal::ZERO && value <= Decimal::from(100)
}

/// Reads one percentage the chart sends, as a JSON number or as a decimal string. The engine reads
/// exact decimals, so a value the chart cannot name exactly is refused at this boundary instead of
/// being rounded on the way in.
fn deserialize_percent<'de, D>(deserializer: D) -> Result<Decimal, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct PercentVisitor;

    impl<'de> serde::de::Visitor<'de> for PercentVisitor {
        type Value = Decimal;

        fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            formatter.write_str("a decimal number or a decimal string")
        }

        fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Decimal, E> {
            value.parse::<Decimal>().map_err(E::custom)
        }

        fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Decimal, E> {
            Ok(Decimal::from(value))
        }

        fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Decimal, E> {
            Ok(Decimal::from(value))
        }

        fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Decimal, E> {
            Decimal::try_from(value).map_err(E::custom)
        }
    }

    deserializer.deserialize_any(PercentVisitor)
}

/// What the chart asked the host for, and the row width the host resolved for it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ChartFootprintState {
    /// The chart's request; `None` while the chart footprint is off.
    request: Option<ChartFootprintRequest>,
    /// The row width the events carry: the chart's own, or the automatic one resolved from the window
    /// it last loaded. Never below one tick, so no event names a footprint without rows.
    ticks_per_row: u32,
}

impl Default for ChartFootprintState {
    fn default() -> Self {
        Self {
            request: None,
            ticks_per_row: MIN_TICKS_PER_ROW,
        }
    }
}

impl ChartFootprintState {
    /// Whether the chart asked for a footprint.
    fn is_on(&self) -> bool {
        self.request.is_some()
    }

    /// The settings a bar's footprint is computed with; `None` while the chart footprint is off.
    fn settings(&self) -> Option<FootprintSettings> {
        let request = self.request?;
        Some(FootprintSettings {
            ticks_per_row: self.ticks_per_row,
            va_percent: request.va_percent,
            imbalance_percent: request.imbalance_percent,
        })
    }

    /// Takes the chart's request. A manual width stands at once; an automatic one waits for the window
    /// read that resolves it, so no width of an earlier window leaks into this one.
    fn take(&mut self, request: ChartFootprintRequest) {
        self.request = Some(request);
        self.ticks_per_row = match request.row_size {
            ChartFootprintRowSize::Manual { ticks_per_row } => ticks_per_row,
            ChartFootprintRowSize::Auto { .. } => MIN_TICKS_PER_ROW,
        };
    }

    /// Forgets the chart's request: nothing is published until the chart asks again.
    fn turn_off(&mut self) {
        self.request = None;
    }

    /// Resolves the row width of the window `candles` over `mintick`: a manual width stands, an
    /// automatic one becomes the window's own.
    fn resolve(&mut self, candles: &[MarketCandle], mintick: Option<Decimal>) {
        let Some(request) = self.request else {
            return;
        };
        let ChartFootprintRowSize::Auto { atr_length } = request.row_size else {
            return;
        };
        self.ticks_per_row = auto_row_size(candles, mintick, atr_length);
    }
}

/// The chart footprint state of `state`: the single place naming the poisoned-mutex expectation.
fn footprint(state: &BridgeState) -> MutexGuard<'_, ChartFootprintState> {
    state
        .chart_footprint
        .lock()
        .expect("chart footprint mutex poisoned")
}

/// Whether the chart asked the host for a footprint.
pub(crate) fn is_on(state: &BridgeState) -> bool {
    footprint(state).is_on()
}

/// The settings the chart's footprints are computed with; `None` while the chart footprint is off.
pub(crate) fn footprint_settings(state: &BridgeState) -> Option<FootprintSettings> {
    footprint(state).settings()
}

/// Stores the chart's request, validating it first: `Some` asks for a footprint, `None` turns it off.
/// Answers whether the chart footprint is on, so the caller knows whether to start the tick read.
pub(crate) fn set_request(
    state: &BridgeState,
    request: Option<ChartFootprintRequest>,
) -> Result<bool, &'static str> {
    if let Some(request) = request {
        request.validate()?;
    }
    let mut footprint = footprint(state);
    match request {
        Some(request) => footprint.take(request),
        None => footprint.turn_off(),
    }
    Ok(footprint.is_on())
}

/// Turns the chart footprint on with `request`, or off with `None`, and reads the window's ticks when
/// it turned on.
pub(crate) fn apply(
    state: &BridgeState,
    request: Option<ChartFootprintRequest>,
) -> Result<(), String> {
    let enabled = set_request(state, request).map_err(str::to_owned)?;
    if enabled {
        read_footprint_ticks(state);
    }
    Ok(())
}

/// Resolves the automatic row width from the window the host just loaded. A manual width stands.
pub(crate) fn resolve_row_size(
    state: &BridgeState,
    candles: &[MarketCandle],
    mintick: Option<Decimal>,
) {
    footprint(state).resolve(candles, mintick);
}

/// The row width an automatic size names: `0.2 * ATR(atr_length)` in the symbol's ticks, at least one.
///
/// The ATR is Wilder's over the loaded window's candles. A window without a readable range or an
/// unknown tick size (the mirror has no entry for the symbol yet) names one tick, the narrowest row
/// the engine rows: an approximation that draws every trade instead of failing to draw the bar.
fn auto_row_size(candles: &[MarketCandle], mintick: Option<Decimal>, atr_length: u32) -> u32 {
    let Some(mintick) = mintick.filter(|mintick| *mintick > Decimal::ZERO) else {
        return MIN_TICKS_PER_ROW;
    };
    let Some(average_range) = average_true_range(candles, atr_length) else {
        return MIN_TICKS_PER_ROW;
    };
    let share = Decimal::from(AUTO_ROW_ATR_SHARE_PERCENT) / Decimal::from(100);
    let width = (average_range * share / mintick)
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero);
    // A window whose range asks for a width past a `u32` saturates instead of wrapping.
    let Some(ticks) = width.to_u64() else {
        return MIN_TICKS_PER_ROW;
    };
    let ticks = u32::try_from(ticks).unwrap_or(u32::MAX);
    ticks.max(MIN_TICKS_PER_ROW)
}

/// Wilder's average true range of `candles` over `length` bars: the mean of the first `length` true
/// ranges, then `(previous * (length - 1) + range) / length` for each bar after them. A window shorter
/// than `length` averages the ranges it has. `None` when the window holds fewer than two bars, no
/// length, or a price it cannot read.
fn average_true_range(candles: &[MarketCandle], length: u32) -> Option<Decimal> {
    if length == 0 {
        return None;
    }
    let mut previous_close: Option<Decimal> = None;
    let mut ranges = Vec::with_capacity(candles.len().saturating_sub(1));
    for candle in candles {
        // Every price of every bar is read, the first bar's own included: a bar the host cannot read
        // answers nothing, so no zero stands in for a range it could not measure.
        let high = price(&candle.high)?;
        let low = price(&candle.low)?;
        let close = price(&candle.close)?;
        if let Some(previous_close) = previous_close {
            ranges.push(true_range(high, low, previous_close));
        }
        previous_close = Some(close);
    }
    let seed_bars = length.min(u32::try_from(ranges.len()).ok()?);
    let seed = ranges.get(..usize::try_from(seed_bars).ok()?)?;
    if seed.is_empty() {
        return None;
    }
    let mut average = seed.iter().copied().sum::<Decimal>() / Decimal::from(seed_bars);
    // The seed is the first `length` ranges or every range the window has; the bars after it are
    // smoothed with the requested length, never with a shorter window's.
    for range in &ranges[seed.len()..] {
        average = (average * Decimal::from(length - 1) + *range) / Decimal::from(length);
    }
    Some(average)
}

/// One bar's true range: its own span, or the larger gap from the previous bar's close.
fn true_range(high: Decimal, low: Decimal, previous_close: Decimal) -> Decimal {
    (high - low)
        .max((high - previous_close).abs())
        .max((low - previous_close).abs())
}

/// One wire price as the decimal the averages read; `None` for text no decimal reads.
fn price(text: &str) -> Option<Decimal> {
    text.parse::<Decimal>().ok()
}
