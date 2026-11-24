//! Heikin Ashi bars: each bar averages its own price with the previous Heikin
//! Ashi bar, which smooths the trend without shifting the time axis.

use rust_decimal::Decimal;

use super::{ChartBar, PriceBar};

/// A Heikin Ashi close is the mean of its base bar's open, high, low and close.
const AVERAGED_PRICE_COUNT: u32 = 4;

/// The Heikin Ashi chart for `bars`: one chart bar per base bar, at that bar's
/// time and with its volume. The first bar has no predecessor, so its open is
/// the mean of its own open and close.
pub fn heikin_ashi(bars: &[PriceBar]) -> Vec<ChartBar> {
    let mut chart_bars = Vec::with_capacity(bars.len());
    let mut previous: Option<(Decimal, Decimal)> = None;
    for bar in bars {
        let close = average_price(bar);
        let open = match previous {
            Some((previous_open, previous_close)) => average(previous_open, previous_close),
            None => average(bar.open, bar.close),
        };
        previous = Some((open, close));
        chart_bars.push(ChartBar {
            time_ms: bar.time_ms,
            open,
            high: bar.high.max(open).max(close),
            low: bar.low.min(open).min(close),
            close,
            volume: bar.volume,
        });
    }
    chart_bars
}

fn average_price(bar: &PriceBar) -> Decimal {
    (bar.open + bar.high + bar.low + bar.close) / Decimal::from(AVERAGED_PRICE_COUNT)
}

fn average(open: Decimal, close: Decimal) -> Decimal {
    (open + close) / Decimal::TWO
}

#[cfg(test)]
#[path = "heikin_ashi_tests.rs"]
mod tests;
