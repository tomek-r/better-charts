//! The chart types of `trading_core`, exposed to the desktop chart.
//!
//! The chart keeps the broker candles it already holds and asks here for the bars a chart type
//! draws from them. The command is read-only: no bridge request and no saved state, so a chart can
//! redraw whenever a setting changes. Prices stay decimal strings at this boundary, like every
//! other price the frontend receives.

#[cfg(test)]
mod tests;

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use trading_core::chart_types::{
    heikin_ashi, kagi, line_break, point_figure, renko, BoxSizing, ChartBar, ChartTypeError,
    PointFigureSource, PriceBar, RenkoWicks,
};
use trading_core::protocol::MarketCandle;

/// The setting a `percentageLtp` method reads: a share of the last close, in percent.
const PERCENTAGE_FIELD: &str = "percentage";

/// The bars `chart` draws from `candles`.
///
/// Read-only: the candles are the ones the chart already holds, so a redraw on every settings
/// change reaches no broker. A price or a spec value that does not parse fails the whole call
/// instead of drawing a bar the broker never sent.
#[tauri::command]
pub(crate) fn compute_chart_type_bars(
    candles: Vec<ChartCandleInput>,
    chart: ChartTypeSpec,
) -> Result<Vec<ChartTypeBarView>, String> {
    let bars = candles
        .into_iter()
        .map(ChartCandleInput::into_price_bar)
        .collect::<Result<Vec<PriceBar>, ChartTypeError>>()
        .map_err(|error| error.to_string())?;
    let chart_bars = chart.draw(&bars).map_err(|error| error.to_string())?;
    let views = chart_bars
        .into_iter()
        .map(ChartTypeBarView::from)
        .collect::<Vec<ChartTypeBarView>>();
    Ok(views)
}

/// One broker candle as the desktop chart sends it: the bridge's candle under the chart's
/// camelCase names, because Tauri arguments are camelCase where the wire payload is snake_case.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartCandleInput {
    time_ms: i64,
    open: String,
    high: String,
    low: String,
    close: String,
    tick_volume: u64,
    spread: u32,
    real_volume: u64,
}

impl ChartCandleInput {
    /// The candle in the bridge's own shape, which is what the chart types read.
    fn into_price_bar(self) -> Result<PriceBar, ChartTypeError> {
        let candle = MarketCandle {
            time_ms: self.time_ms,
            open: self.open,
            high: self.high,
            low: self.low,
            close: self.close,
            tick_volume: self.tick_volume,
            spread: self.spread,
            real_volume: self.real_volume,
        };
        PriceBar::from_market_candle(&candle)
    }
}

/// The five chart kinds the settings offer, one tagged JSON object each.
///
/// Every kind carries the parameters of all its box methods at once — the method names the one
/// that sizes its box and the others are ignored — so the frontend sends one shape per chart type.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum ChartTypeSpec {
    HeikinAshi,
    LineBreak {
        lines: u32,
    },
    #[serde(rename_all = "camelCase")]
    Renko {
        box_method: BoxMethod,
        atr_length: u32,
        box_size: String,
        percentage: String,
        wicks: bool,
    },
    #[serde(rename_all = "camelCase")]
    Kagi {
        reversal_method: BoxMethod,
        atr_length: u32,
        reversal: String,
        percentage: String,
    },
    #[serde(rename_all = "camelCase")]
    PointFigure {
        source: PointFigureSourceInput,
        box_method: BoxMethod,
        atr_length: u32,
        box_size: String,
        percentage: String,
        reversal: u32,
    },
}

impl ChartTypeSpec {
    /// The bars this chart type draws from `bars`, in the order they formed.
    fn draw(&self, bars: &[PriceBar]) -> Result<Vec<ChartBar>, ChartSpecError> {
        match self {
            Self::HeikinAshi => Ok(heikin_ashi(bars)),
            Self::LineBreak { lines } => Ok(line_break(bars, *lines)?),
            Self::Renko {
                box_method,
                atr_length,
                box_size,
                percentage,
                wicks,
            } => {
                let sizing = box_method.sizing(box_size, "boxSize", *atr_length, percentage)?;
                Ok(renko(bars, sizing, wick_mode(*wicks))?)
            }
            Self::Kagi {
                reversal_method,
                atr_length,
                reversal,
                percentage,
            } => {
                let sizing =
                    reversal_method.sizing(reversal, "reversal", *atr_length, percentage)?;
                Ok(kagi(bars, sizing)?)
            }
            Self::PointFigure {
                source,
                box_method,
                atr_length,
                box_size,
                percentage,
                reversal,
            } => {
                let sizing = box_method.sizing(box_size, "boxSize", *atr_length, percentage)?;
                Ok(point_figure(bars, (*source).into(), sizing, *reversal)?)
            }
        }
    }
}

/// How a box-sized chart type sizes the move that draws its next bar, the settings' `boxMethod`
/// and `reversalMethod`; the name says which parameter applies.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BoxMethod {
    Traditional,
    Atr,
    PercentageLtp,
}

impl BoxMethod {
    /// The box this method asks for, from the parameters the settings carry for all methods.
    ///
    /// Only the method's own parameter is parsed, so a setting it does not read may be blank or
    /// unparseable; `field` names the setting the parsed distance comes from.
    fn sizing(
        &self,
        distance: &str,
        field: &'static str,
        atr_length: u32,
        percentage: &str,
    ) -> Result<BoxSizing, ChartSpecError> {
        match self {
            Self::Traditional => {
                let price = parse_setting(distance, field)?;
                Ok(BoxSizing::Traditional(price))
            }
            Self::Atr => Ok(BoxSizing::Atr(atr_length)),
            Self::PercentageLtp => {
                let percent = parse_setting(percentage, PERCENTAGE_FIELD)?;
                Ok(BoxSizing::PercentageLtp(percent))
            }
        }
    }
}

/// Which prices a point & figure column reads, the settings' `source`.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PointFigureSourceInput {
    HighLow,
    Close,
}

impl From<PointFigureSourceInput> for PointFigureSource {
    fn from(source: PointFigureSourceInput) -> Self {
        match source {
            PointFigureSourceInput::HighLow => Self::HighLow,
            PointFigureSourceInput::Close => Self::Close,
        }
    }
}

/// Why a chart type could not draw: a setting of the spec, or one of the chart type's own rules.
#[derive(Debug, Error)]
enum ChartSpecError {
    #[error("invalid decimal {field}")]
    InvalidDecimal { field: &'static str },
    #[error(transparent)]
    ChartType(#[from] ChartTypeError),
}

/// A decimal setting, which the spec carries as the text of the setting it comes from.
fn parse_setting(text: &str, field: &'static str) -> Result<Decimal, ChartSpecError> {
    text.parse::<Decimal>()
        .map_err(|_| ChartSpecError::InvalidDecimal { field })
}

/// TradingView's `request_wicks` flag as the crate's wick mode.
fn wick_mode(requested: bool) -> RenkoWicks {
    if requested {
        RenkoWicks::With
    } else {
        RenkoWicks::Without
    }
}

/// One chart bar as the chart draws it: prices are the decimal strings the chart parses.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChartTypeBarView {
    time_ms: i64,
    open: String,
    high: String,
    low: String,
    close: String,
    volume: String,
}

impl From<ChartBar> for ChartTypeBarView {
    fn from(bar: ChartBar) -> Self {
        Self {
            time_ms: bar.time_ms,
            open: decimal_string(bar.open),
            high: decimal_string(bar.high),
            low: decimal_string(bar.low),
            close: decimal_string(bar.close),
            volume: decimal_string(bar.volume),
        }
    }
}

/// A price or volume as the chart reads it, without the trailing zeros the arithmetic adds.
fn decimal_string(value: Decimal) -> String {
    value.normalize().to_string()
}
