//! Dump the chart bars a broker-independent chart type draws from a JSON bar
//! file, so a capture can be compared with TradingView. Never connects to MT5.
//!
//! Input: `{"bars": [{"timeMs", "open", "high", "low", "close", "volume"}],
//! "chart": {"type": "heikinAshi"} | {"type": "lineBreak", "lines": 3} |
//! {"type": "renko", "style": "Traditional", "param": "5000", "wicks": false} |
//! {"type": "kagi", "style": "Traditional", "param": "5000"} |
//! {"type": "pointFigure", "source": "hl", "style": "Traditional", "param":
//! "2000", "reversal": 3}}`, with prices and volume as decimal strings (JSON
//! numbers are accepted too).
//! Output: the chart bars as a JSON array of `{"timeMs", "open", "high", "low",
//! "close"}` decimal strings.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use trading_core::chart_types::{
    heikin_ashi, kagi, line_break, point_figure, renko, BoxSizing, ChartBar, PointFigureSource,
    PriceBar, RenkoWicks,
};

const USAGE: &str = "usage: chart_bars_dump <chart-bars.json>";

fn main() {
    let mut arguments = std::env::args().skip(1);
    let path = match (arguments.next(), arguments.next()) {
        (Some(path), None) => path,
        _ => usage(),
    };
    if let Err(error) = run(&path) {
        eprintln!("chart_bars_dump: {error}");
        std::process::exit(1);
    }
}

fn usage() -> ! {
    eprintln!("{USAGE}");
    std::process::exit(2);
}

fn run(path: &str) -> Result<(), Box<dyn std::error::Error>> {
    let request: ChartRequest = serde_json::from_slice(&std::fs::read(path)?)?;
    let bars = request
        .bars
        .iter()
        .map(PriceBarInput::to_price_bar)
        .collect::<Result<Vec<_>, _>>()?;
    let chart_bars = match request.chart {
        ChartInput::HeikinAshi => heikin_ashi(&bars),
        ChartInput::LineBreak { lines } => line_break(&bars, lines)?,
        ChartInput::Renko {
            style,
            param,
            wicks,
        } => renko(&bars, style.to_box_sizing(&param)?, wicks_mode(wicks))?,
        ChartInput::Kagi { style, param } => kagi(&bars, style.to_box_sizing(&param)?)?,
        ChartInput::PointFigure {
            source,
            style,
            param,
            reversal,
        } => point_figure(&bars, source.into(), style.to_box_sizing(&param)?, reversal)?,
    };
    let dump = chart_bars
        .iter()
        .map(ChartBarOutput::from)
        .collect::<Vec<_>>();
    println!("{}", serde_json::to_string_pretty(&dump)?);
    Ok(())
}

#[derive(Deserialize)]
struct ChartRequest {
    bars: Vec<PriceBarInput>,
    chart: ChartInput,
}

/// One variant per chart type; a new chart type adds one arm to the match in
/// [`run`].
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ChartInput {
    HeikinAshi,
    LineBreak {
        lines: u32,
    },
    Renko {
        style: BoxStyleInput,
        param: DecimalInput,
        #[serde(default)]
        wicks: bool,
    },
    Kagi {
        style: BoxStyleInput,
        param: DecimalInput,
    },
    PointFigure {
        source: PointFigureSourceInput,
        style: BoxStyleInput,
        param: DecimalInput,
        reversal: u32,
    },
}

/// The box styles the chart settings offer, with the `param` each one reads; the
/// aliases accept the spellings TradingView's own settings and scripts use.
#[derive(Deserialize)]
enum BoxStyleInput {
    #[serde(alias = "traditional")]
    Traditional,
    #[serde(alias = "ATR", alias = "atr")]
    Atr,
    #[serde(
        alias = "PercentageLTP",
        alias = "percentageLTP",
        alias = "percentageLtp"
    )]
    PercentageLtp,
}

impl BoxStyleInput {
    /// The sizing the settings ask for. They write the amount in the style's own
    /// unit, so the ATR style reads a whole number of bars where the others read
    /// a price.
    fn to_box_sizing(&self, param: &DecimalInput) -> Result<BoxSizing, String> {
        match self {
            Self::Traditional => Ok(BoxSizing::Traditional(param.to_decimal()?)),
            Self::Atr => Ok(BoxSizing::Atr(param.to_bar_count()?)),
            Self::PercentageLtp => Ok(BoxSizing::PercentageLtp(param.to_decimal()?)),
        }
    }
}

/// The source names `ticker.pointfigure` offers.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum PointFigureSourceInput {
    Hl,
    Close,
}

impl From<PointFigureSourceInput> for PointFigureSource {
    fn from(source: PointFigureSourceInput) -> Self {
        match source {
            PointFigureSourceInput::Hl => Self::HighLow,
            PointFigureSourceInput::Close => Self::Close,
        }
    }
}

/// TradingView's `request_wicks` flag as the crate's wick mode.
fn wicks_mode(requested: bool) -> RenkoWicks {
    if requested {
        RenkoWicks::With
    } else {
        RenkoWicks::Without
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PriceBarInput {
    time_ms: i64,
    open: DecimalInput,
    high: DecimalInput,
    low: DecimalInput,
    close: DecimalInput,
    volume: DecimalInput,
}

impl PriceBarInput {
    fn to_price_bar(&self) -> Result<PriceBar, String> {
        Ok(PriceBar {
            time_ms: self.time_ms,
            open: self.open.to_decimal()?,
            high: self.high.to_decimal()?,
            low: self.low.to_decimal()?,
            close: self.close.to_decimal()?,
            volume: self.volume.to_decimal()?,
        })
    }
}

/// A price or volume the contract writes as a decimal string; a JSON number is
/// accepted too so a hand-written file stays short.
#[derive(Deserialize)]
#[serde(untagged)]
enum DecimalInput {
    Text(String),
    Number(serde_json::Number),
}

impl DecimalInput {
    fn to_decimal(&self) -> Result<Decimal, String> {
        match self {
            Self::Text(text) => text
                .parse::<Decimal>()
                .map_err(|_| format!("invalid decimal {text:?}")),
            Self::Number(number) => number
                .to_string()
                .parse::<Decimal>()
                .map_err(|_| format!("invalid decimal {number}")),
        }
    }

    /// A count of bars, which the settings still write in `param`.
    fn to_bar_count(&self) -> Result<u32, String> {
        match self {
            Self::Text(text) => text
                .parse()
                .map_err(|_| format!("invalid bar count {text:?}")),
            Self::Number(number) => number
                .as_u64()
                .and_then(|count| u32::try_from(count).ok())
                .ok_or_else(|| format!("invalid bar count {number}")),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChartBarOutput {
    time_ms: i64,
    open: String,
    high: String,
    low: String,
    close: String,
}

impl From<&ChartBar> for ChartBarOutput {
    fn from(bar: &ChartBar) -> Self {
        Self {
            time_ms: bar.time_ms,
            open: price_string(bar.open),
            high: price_string(bar.high),
            low: price_string(bar.low),
            close: price_string(bar.close),
        }
    }
}

fn price_string(price: Decimal) -> String {
    price.normalize().to_string()
}
