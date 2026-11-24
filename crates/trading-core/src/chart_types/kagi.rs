//! Kagi bars: a close-driven chart that draws a new line whenever a close
//! travels far enough to turn the last one, and extends the line while closes
//! keep making new extremes in its direction.

use rust_decimal::Decimal;

use super::{bar_between, check_increasing_times, BoxSizing, ChartBar, ChartTypeError, PriceBar};

/// The Kagi chart for `bars`, turning the line once a close travels `reversal`
/// back from the line's extreme.
///
/// The first line opens at the first bar's close and keeps that bar's time, but
/// it only prints on the first later close that differs from it, so it runs in
/// that close's direction. A close that makes a new extreme in the line's
/// direction extends it — its end, its high or low and its volume move, and it
/// keeps its start and its time — so later closes never start a line of their
/// own. Only a close that travels `reversal` against the line's extreme starts a
/// new line, on the bar drawing it, opening at the extreme the last line
/// reached. A base bar draws or extends at most one line.
///
/// Volume sums the bars that drew or extended a line, which no capture confirms
/// yet.
pub fn kagi(bars: &[PriceBar], reversal: BoxSizing) -> Result<Vec<ChartBar>, ChartTypeError> {
    let amount = reversal.amount(bars)?;
    check_increasing_times(bars)?;
    let Some((first_bar, later_bars)) = bars.split_first() else {
        return Ok(Vec::new());
    };
    let mut lines: Vec<ChartBar> = Vec::new();
    // The line still open, held here so an extension can move it in place and a
    // reversal can finish it.
    let mut current: Option<ChartBar> = None;
    for bar in later_bars {
        match current {
            None => current = opening_line(first_bar, bar),
            Some(line) if extends(&line, bar.close) => current = Some(extended_line(line, bar)),
            Some(line) if reverses(&line, bar.close, amount) => {
                lines.push(line);
                current = Some(turning_line(&line, bar));
            }
            Some(_) => {}
        }
    }
    if let Some(line) = current {
        lines.push(line);
    }
    Ok(lines)
}

/// The first line opens at the first bar's close and keeps that bar's time, so
/// it waits for a close that differs from that close.
fn opening_line(first_bar: &PriceBar, bar: &PriceBar) -> Option<ChartBar> {
    if bar.close == first_bar.close {
        return None;
    }
    Some(line_drawn(first_bar.time_ms, first_bar.close, bar))
}

/// The line `bar` extends: it keeps its start and its time, and takes the bar's
/// close as its new extreme and the bar's volume.
fn extended_line(mut line: ChartBar, bar: &PriceBar) -> ChartBar {
    line.close = bar.close;
    line.high = line.high.max(bar.close);
    line.low = line.low.min(bar.close);
    line.volume += bar.volume;
    line
}

/// The line `bar` turns the last one with: it opens at the extreme `last`
/// reached and is dated the bar that draws it.
fn turning_line(last: &ChartBar, bar: &PriceBar) -> ChartBar {
    line_drawn(bar.time_ms, extreme(last), bar)
}

/// A close extends a line while it makes a new extreme in the line's direction:
/// above the high of an up line, below the low of a down line.
fn extends(line: &ChartBar, close: Decimal) -> bool {
    if runs_up(line) {
        close > line.high
    } else {
        close < line.low
    }
}

/// A close turns an up line once it falls `amount` below the line's high, and a
/// down line once it rises `amount` above its low.
fn reverses(line: &ChartBar, close: Decimal, amount: Decimal) -> bool {
    if runs_up(line) {
        close <= extreme(line) - amount
    } else {
        close >= extreme(line) + amount
    }
}

/// The price a line reached furthest in its direction, which is where the next
/// line opens.
fn extreme(line: &ChartBar) -> Decimal {
    if runs_up(line) {
        line.high
    } else {
        line.low
    }
}

/// Which way a line runs. A line always ends away from where it started, so the
/// two never meet.
fn runs_up(line: &ChartBar) -> bool {
    line.close > line.open
}

/// A line opening at `open` and ending at `bar`'s close, dated the bar that drew
/// it and carrying that bar's volume until later bars extend it.
fn line_drawn(time_ms: i64, open: Decimal, bar: &PriceBar) -> ChartBar {
    ChartBar {
        volume: bar.volume,
        ..bar_between(time_ms, open, bar.close)
    }
}

#[cfg(test)]
#[path = "kagi_tests.rs"]
mod tests;
