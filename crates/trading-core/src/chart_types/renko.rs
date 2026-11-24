//! Renko bricks: TradingView's Renko chart type, where a brick is one box tall
//! and only the closes decide when the next one starts.
//!
//! Brick levels sit on a grid of multiples of the box size. Before the first
//! brick the grid hangs on the first close rounded to the nearest multiple, so a
//! chart opens with the box the price actually crossed instead of a run of bricks
//! up from zero. An up trend adds a brick for every full box the close reaches
//! above the last brick's top; only a close two boxes below that top turns the
//! trend down, and the reversal then draws one brick per full box down from the
//! last brick's bottom. Every brick of one base bar takes that bar's `time_ms`
//! and each further brick of the bar one millisecond more, the way TradingView
//! times them, so the bricks of a chart keep strictly increasing times.

use rust_decimal::Decimal;

use super::{check_increasing_times, BoxSizing, ChartBar, ChartTypeError, PriceBar};

/// How much later than the brick before it every further brick of one base bar
/// is timed, so the bricks of a bar never share a time: TradingView times the
/// two bricks of one week `1612742400000` and `1612742400001`.
const BRICK_TIME_STEP_MS: i64 = 1;

/// Whether bricks carry wicks, TradingView's `request_wicks` argument.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenkoWicks {
    /// Bodies only: a brick's high and low are its two levels.
    Without,
    /// A brick also reaches the closes that went beyond the previous brick.
    With,
}

/// Where bricks take their prices from, TradingView's `source` argument.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenkoSource {
    /// Bricks follow the bars' closes.
    Close,
    /// TradingView also walks open, high and low of every bar. No capture has
    /// confirmed the order it walks them in, so this crate refuses the source
    /// rather than draw bricks it cannot match.
    Ohlc,
}

/// The Renko chart for `bars` with the box `sizing` asks for, built from the
/// bars' closes.
///
/// A brick takes the time of the base bar that formed it, and when one bar forms
/// several bricks its first brick takes the bar's time and every further brick a
/// millisecond more, as TradingView times them, so the bricks' times strictly
/// increase. Volume is UNVERIFIED against TradingView, which does not chart
/// volume on Renko: the first brick of a bar takes that bar's volume and the
/// bar's other bricks take none.
///
/// With [`RenkoWicks::With`] a brick's high and low also reach the closes that
/// went beyond the previous brick — the closes TradingView draws as wicks. Only
/// the first brick of a bar carries them: TradingView draws the bar's own close,
/// which is what crossed the level, as the body alone, and a close inside the
/// previous brick is already covered by it.
pub fn renko(
    bars: &[PriceBar],
    sizing: BoxSizing,
    wicks: RenkoWicks,
) -> Result<Vec<ChartBar>, ChartTypeError> {
    renko_with_source(bars, sizing, wicks, RenkoSource::Close)
}

/// The Renko chart for `bars` read from `source`, which nothing but
/// [`RenkoSource::Close`] can be yet.
pub fn renko_with_source(
    bars: &[PriceBar],
    sizing: BoxSizing,
    wicks: RenkoWicks,
    source: RenkoSource,
) -> Result<Vec<ChartBar>, ChartTypeError> {
    if source != RenkoSource::Close {
        return Err(ChartTypeError::UnsupportedSource { name: "OHLC" });
    }
    check_increasing_times(bars)?;
    let Some(first_bar) = bars.first() else {
        return Ok(Vec::new());
    };
    let box_size = sizing.box_size(bars)?;
    let mut builder =
        RenkoBuilder::new(box_size, nearest_multiple(first_bar.close, box_size), wicks);
    for bar in bars {
        builder.advance(bar);
    }
    Ok(builder.bricks)
}

/// The multiple of `box_size` nearest to `value`: the level the grid hangs on
/// before the first brick.
fn nearest_multiple(value: Decimal, box_size: Decimal) -> Decimal {
    let half = Decimal::new(5, 1);
    ((value / box_size) + half).floor() * box_size
}

/// Which way a brick points.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Direction {
    Up,
    Down,
}

impl Direction {
    /// The direction a drawn brick points.
    fn of(brick: ChartBar) -> Self {
        if brick.close > brick.open {
            Self::Up
        } else {
            Self::Down
        }
    }

    fn opposite(self) -> Self {
        match self {
            Self::Up => Self::Down,
            Self::Down => Self::Up,
        }
    }

    /// The level one box further in this direction.
    fn step(self, level: Decimal, box_size: Decimal) -> Decimal {
        match self {
            Self::Up => level + box_size,
            Self::Down => level - box_size,
        }
    }

    /// Whether a close at `close` reached `level` in this direction.
    fn reached(self, close: Decimal, level: Decimal) -> bool {
        match self {
            Self::Up => close >= level,
            Self::Down => close <= level,
        }
    }
}

/// The bricks of a chart, built one base bar at a time.
struct RenkoBuilder {
    box_size: Decimal,
    wicks: RenkoWicks,
    /// The level the grid hangs on before the first brick.
    reference: Decimal,
    /// The brick the trend hangs on: its open is the near level the next
    /// reversal starts from and its close the far level a continuation crosses.
    last_brick: Option<ChartBar>,
    /// The highest and lowest close that went beyond the last brick: what the
    /// next bar's first brick draws as wicks.
    wick_high: Option<Decimal>,
    wick_low: Option<Decimal>,
    bricks: Vec<ChartBar>,
}

impl RenkoBuilder {
    fn new(box_size: Decimal, reference: Decimal, wicks: RenkoWicks) -> Self {
        Self {
            box_size,
            wicks,
            reference,
            last_brick: None,
            wick_high: None,
            wick_low: None,
            bricks: Vec::new(),
        }
    }

    /// Adds the bricks `bar` draws and remembers the closes its neighbours may
    /// reach as wicks.
    fn advance(&mut self, bar: &PriceBar) {
        let drawn = self.bricks.len();
        let last_brick = self.last_brick;
        match last_brick {
            None => self.opening_bricks(bar),
            Some(last) => self.next_bricks(last, bar),
        }
        if self.bricks.len() == drawn {
            self.observe(bar.close);
        }
    }

    /// Before the first brick the grid hangs on the reference level, so the first
    /// brick needs a full box on either side of it.
    fn opening_bricks(&mut self, bar: &PriceBar) {
        let reference = self.reference;
        for direction in [Direction::Up, Direction::Down] {
            if direction.reached(bar.close, direction.step(reference, self.box_size)) {
                self.draw_bricks(bar, reference, direction);
                return;
            }
        }
    }

    /// A close beyond the far level of the last brick continues the trend; a
    /// close that clears the near level by a full box turns it around.
    fn next_bricks(&mut self, last: ChartBar, bar: &PriceBar) {
        let direction = Direction::of(last);
        if direction.reached(bar.close, direction.step(last.close, self.box_size)) {
            self.draw_bricks(bar, last.close, direction);
            return;
        }
        let reversal = direction.opposite();
        if reversal.reached(bar.close, reversal.step(last.open, self.box_size)) {
            self.draw_bricks(bar, last.open, reversal);
        }
    }

    /// Draws one brick per full box the close covers from `from_level` on.
    fn draw_bricks(&mut self, bar: &PriceBar, from_level: Decimal, direction: Direction) {
        let mut level = from_level;
        let mut volume = bar.volume;
        loop {
            let next = direction.step(level, self.box_size);
            if !direction.reached(bar.close, next) {
                return;
            }
            self.push_brick(bar, level, next, volume);
            volume = Decimal::ZERO;
            level = next;
        }
    }

    fn push_brick(&mut self, bar: &PriceBar, open: Decimal, close: Decimal, volume: Decimal) {
        let brick = self.brick(bar, open, close, volume);
        self.bricks.push(brick);
        self.last_brick = Some(brick);
        // The closes found so far belong to the bar's first brick alone.
        self.wick_high = None;
        self.wick_low = None;
    }

    fn brick(&self, bar: &PriceBar, open: Decimal, close: Decimal, volume: Decimal) -> ChartBar {
        let body_high = open.max(close);
        let body_low = open.min(close);
        ChartBar {
            time_ms: self.brick_time(bar),
            open,
            high: self.wick_high.map_or(body_high, |high| body_high.max(high)),
            low: self.wick_low.map_or(body_low, |low| body_low.min(low)),
            close,
            volume,
        }
    }

    /// The time of the next brick: its base bar's own time, but at least one step
    /// after the previous brick, so the second and third bricks of a bar land on
    /// `t + 1` and `t + 2` and even a bar starting that soon still moves forward.
    fn brick_time(&self, bar: &PriceBar) -> i64 {
        let Some(last) = self.last_brick else {
            return bar.time_ms;
        };
        let after_last = last.time_ms.saturating_add(BRICK_TIME_STEP_MS);
        bar.time_ms.max(after_last)
    }

    /// Remembers a close that went beyond the last brick. A close inside that
    /// brick is already covered by it and no wick.
    fn observe(&mut self, close: Decimal) {
        if !matches!(self.wicks, RenkoWicks::With) {
            return;
        }
        let Some(last) = self.last_brick else {
            return;
        };
        let top = last.open.max(last.close);
        let bottom = last.open.min(last.close);
        if close > top {
            self.wick_high = Some(self.wick_high.map_or(close, |high| high.max(close)));
        }
        if close < bottom {
            self.wick_low = Some(self.wick_low.map_or(close, |low| low.min(close)));
        }
    }
}

#[cfg(test)]
#[path = "renko_tests.rs"]
mod tests;
