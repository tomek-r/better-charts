//! Point & Figure columns: a chart that prints one column per price movement
//! on a grid of fixed boxes.

use rust_decimal::Decimal;

use super::{check_increasing_times, BoxSizing, ChartBar, ChartTypeError, PriceBar};

/// Reported in [`ChartTypeError::NonPositiveParameter`] for a zero reversal.
const PARAMETER_REVERSAL: &str = "reversal";

/// Which prices a Point & Figure chart reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PointFigureSource {
    /// Highs extend a rising column and lows a falling one, TradingView's "hl".
    HighLow,
    /// The close stands in for both the high and the low, TradingView's
    /// "close".
    Close,
}

/// The Point & Figure columns for `bars`, drawn as TradingView's
/// `ticker.pointfigure(symbol, source, style, param, reversal)` draws them.
///
/// Boxes lie on multiples of the box `sizing` resolves to. A rising (X) column
/// opens at its lowest box and closes at its highest, a falling (O) column
/// opens at its highest and closes at its lowest; high and low are the two ends
/// either way. A base bar first extends the current column to the box its price
/// reaches; only when it cannot does it test a reversal, which needs `reversal`
/// boxes against the column and opens the opposite column one box back from the
/// old tip. So a base bar draws at most one column, and the first column is a
/// rising one from the box below the first bar's low. A column is dated the bar
/// that opened it and sums the volume of every bar it covers.
pub fn point_figure(
    bars: &[PriceBar],
    source: PointFigureSource,
    sizing: BoxSizing,
    reversal: u32,
) -> Result<Vec<ChartBar>, ChartTypeError> {
    if reversal == 0 {
        return Err(ChartTypeError::NonPositiveParameter {
            name: PARAMETER_REVERSAL,
        });
    }
    check_increasing_times(bars)?;
    let box_size = sizing.box_size(bars)?;
    let Some((first_bar, later_bars)) = bars.split_first() else {
        return Ok(Vec::new());
    };
    let reversal_distance = box_size * Decimal::from(reversal);
    let mut current = opening_column(first_bar, source, box_size);
    let mut columns = Vec::new();
    for bar in later_bars {
        if !extends(&mut current, bar, source, box_size)
            && reverses(&current, bar, source, reversal_distance)
        {
            let next = reversal_column(&current, bar, source, box_size);
            columns.push(current);
            current = next;
        }
        current.volume += bar.volume;
    }
    columns.push(current);
    Ok(columns.into_iter().map(Column::chart_bar).collect())
}

/// The boxes one column covers, from the box it opened at to its tip.
#[derive(Debug, Clone, Copy)]
struct Column {
    direction: Direction,
    /// The box the column opened at.
    open: Decimal,
    /// The furthest box the column has reached, which is where it closes.
    tip: Decimal,
    time_ms: i64,
    volume: Decimal,
}

impl Column {
    fn chart_bar(self) -> ChartBar {
        ChartBar {
            time_ms: self.time_ms,
            open: self.open,
            high: self.open.max(self.tip),
            low: self.open.min(self.tip),
            close: self.tip,
            volume: self.volume,
        }
    }
}

/// The way a column grows.
#[derive(Debug, Clone, Copy)]
enum Direction {
    /// An X column, which grows towards higher boxes.
    Rising,
    /// An O column, which grows towards lower boxes.
    Falling,
}

impl Direction {
    fn opposite(self) -> Self {
        match self {
            Self::Rising => Self::Falling,
            Self::Falling => Self::Rising,
        }
    }
}

/// The first column: a rising one whose lowest box holds the first low and
/// whose highest box holds the first high. The first bar only opens it and is
/// never tested for a reversal.
fn opening_column(first_bar: &PriceBar, source: PointFigureSource, box_size: Decimal) -> Column {
    let (high, low) = prices(first_bar, source);
    Column {
        direction: Direction::Rising,
        open: floor_to_grid(low, box_size),
        tip: floor_to_grid(high, box_size),
        time_ms: first_bar.time_ms,
        volume: first_bar.volume,
    }
}

/// Reaches the box the bar's price gets to when it lies beyond the column's
/// tip, and reports whether it did; a column never shrinks.
fn extends(
    column: &mut Column,
    bar: &PriceBar,
    source: PointFigureSource,
    box_size: Decimal,
) -> bool {
    let (high, low) = prices(bar, source);
    let (reached, beyond) = match column.direction {
        Direction::Rising => {
            let reached = floor_to_grid(high, box_size);
            (reached, reached > column.tip)
        }
        Direction::Falling => {
            let reached = ceil_to_grid(low, box_size);
            (reached, reached < column.tip)
        }
    };
    if beyond {
        column.tip = reached;
    }
    beyond
}

/// Whether the bar moves `reversal_distance` against the column, which starts a
/// new one. A base bar reaches this only after it failed to extend the column.
fn reverses(
    column: &Column,
    bar: &PriceBar,
    source: PointFigureSource,
    reversal_distance: Decimal,
) -> bool {
    let (high, low) = prices(bar, source);
    match column.direction {
        Direction::Rising => low <= column.tip - reversal_distance,
        Direction::Falling => high >= column.tip + reversal_distance,
    }
}

/// The column one box against the old tip, running to the box the reversing bar
/// reaches and dated by it. Its volume starts empty: the caller adds the
/// reversing bar's volume.
fn reversal_column(
    previous: &Column,
    bar: &PriceBar,
    source: PointFigureSource,
    box_size: Decimal,
) -> Column {
    let direction = previous.direction.opposite();
    let (high, low) = prices(bar, source);
    let (open, tip) = match direction {
        Direction::Rising => (previous.tip + box_size, floor_to_grid(high, box_size)),
        Direction::Falling => (previous.tip - box_size, ceil_to_grid(low, box_size)),
    };
    Column {
        direction,
        open,
        tip,
        time_ms: bar.time_ms,
        volume: Decimal::ZERO,
    }
}

/// The highest and lowest prices the column directions read from the bar; the
/// "close" source reads its close for both.
fn prices(bar: &PriceBar, source: PointFigureSource) -> (Decimal, Decimal) {
    match source {
        PointFigureSource::HighLow => (bar.high, bar.low),
        PointFigureSource::Close => (bar.close, bar.close),
    }
}

/// The box level at or below `price`, the furthest a rising column reaches.
fn floor_to_grid(price: Decimal, box_size: Decimal) -> Decimal {
    (price / box_size).floor() * box_size
}

/// The box level at or above `price`, the furthest a falling column reaches.
fn ceil_to_grid(price: Decimal, box_size: Decimal) -> Decimal {
    (price / box_size).ceil() * box_size
}

#[cfg(test)]
#[path = "point_figure_tests.rs"]
mod tests;
