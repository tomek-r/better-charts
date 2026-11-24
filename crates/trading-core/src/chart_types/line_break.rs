//! Line Break bars: a close-driven chart that prints one line per new move and
//! ignores open, high and low of the base bars entirely.

use rust_decimal::Decimal;

use super::{check_increasing_times, ChartBar, ChartTypeError, PriceBar};

/// Reported in [`ChartTypeError::NonPositiveParameter`] for a zero window.
const PARAMETER_NUMBER_OF_LINES: &str = "number_of_lines";

/// The Line Break chart for `bars` with a reversal window of `number_of_lines`.
///
/// The first line opens at the first bar's close and is drawn at the first later
/// bar whose close differs. After that a base bar draws at most one line: a
/// continuation beyond the last line's close, or a reversal when its close goes
/// past the lowest (after an up line) or highest (after a down line) open and
/// close of the last `number_of_lines` lines. A reversal opens at the last
/// line's open, so it replaces the range that line covered. Each line takes its
/// time and volume from the bar that drew it.
pub fn line_break(
    bars: &[PriceBar],
    number_of_lines: u32,
) -> Result<Vec<ChartBar>, ChartTypeError> {
    if number_of_lines == 0 {
        return Err(ChartTypeError::NonPositiveParameter {
            name: PARAMETER_NUMBER_OF_LINES,
        });
    }
    check_increasing_times(bars)?;
    let window = usize::try_from(number_of_lines).unwrap_or(usize::MAX);
    let mut lines = Vec::new();
    let Some((first_bar, later_bars)) = bars.split_first() else {
        return Ok(lines);
    };
    for bar in later_bars {
        let line = if lines.is_empty() {
            opening_line(first_bar.close, bar)
        } else {
            next_line(&lines, bar, window)
        };
        if let Some(line) = line {
            lines.push(line);
        }
    }
    Ok(lines)
}

/// The first line opens at the first bar's close, so it never prints on that
/// bar and waits for a close that differs from it.
fn opening_line(opening_close: Decimal, bar: &PriceBar) -> Option<ChartBar> {
    if bar.close == opening_close {
        return None;
    }
    Some(line_from(opening_close, bar))
}

fn next_line(lines: &[ChartBar], bar: &PriceBar, window: usize) -> Option<ChartBar> {
    let last = lines.last()?;
    let rising = last.close > last.open;
    let continues = if rising {
        bar.close > last.close
    } else {
        bar.close < last.close
    };
    if continues {
        return Some(line_from(last.close, bar));
    }
    let recent = &lines[lines.len().saturating_sub(window)..];
    if !reverses(last, recent, bar.close) {
        return None;
    }
    Some(line_from(last.open, bar))
}

/// A reversal needs the close past every open and close of the recent lines, in
/// the direction opposite to the last line.
fn reverses(last: &ChartBar, recent: &[ChartBar], close: Decimal) -> bool {
    let rising = last.close > last.open;
    recent.iter().all(|line| {
        if rising {
            close < line.open.min(line.close)
        } else {
            close > line.open.max(line.close)
        }
    })
}

fn line_from(open: Decimal, bar: &PriceBar) -> ChartBar {
    ChartBar {
        time_ms: bar.time_ms,
        open,
        high: open.max(bar.close),
        low: open.min(bar.close),
        close: bar.close,
        volume: bar.volume,
    }
}

#[cfg(test)]
#[path = "line_break_tests.rs"]
mod tests;
