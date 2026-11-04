import type { BarData, CandlestickData, HistogramData, LineData, Time, UTCTimestamp } from 'lightweight-charts';
import { paintedColor } from '../bars/candleAppearance';
import type { RenderBar } from '../bars/renderBar';
import type {
  BarDirectionColors,
  BarsAppearance,
  ColumnsAppearance,
  DrawnBarStyleAppearance,
  HollowCandlesAppearance,
} from './barStyleAppearance';
import { priceAt, type PriceSource } from './priceSource';

/** The point a bar style series holds: the library's own shape for the series type that draws the style. */
export type BarStylePoint = BarData<Time> | CandlestickData<Time> | HistogramData<Time> | LineData<Time>;

/** A hollow candle paints its body as a hole, so a part that is off writes no colour at all. */
const TRANSPARENT = 'transparent';

/** A bar rises when it closes at or above the reference its style compares it with. */
function roseTo(bar: RenderBar, reference: number): boolean {
  return bar.close >= reference;
}

/** The colour a direction takes: the up colour for a bar that rose, the down one for a bar that fell. */
function directionColor(colors: BarDirectionColors, rising: boolean): string {
  return rising ? colors.up : colors.down;
}

/**
 * The direction of the previous-close rules: what the bar did against the bar before it. The first bar
 * has none, so it is read against its own open.
 */
function roseAgainstPreviousClose(bar: RenderBar, previous: RenderBar | undefined): boolean {
  return roseTo(bar, previous?.close ?? bar.open);
}

/** The colour one bar takes in a style that colours its points one by one. */
function barColor(
  bar: RenderBar,
  previous: RenderBar | undefined,
  appearance: BarsAppearance | ColumnsAppearance,
): string {
  const rising = appearance.colorByPreviousClose ? roseAgainstPreviousClose(bar, previous) : roseTo(bar, bar.open);
  return directionColor(appearance.colors, rising);
}

/** The point the line and area styles plot: one value per bar, at the appearance's price source. */
function valuePoint(bar: RenderBar, source: PriceSource): LineData<Time> {
  return { time: bar.time as UTCTimestamp, value: priceAt(bar, source) };
}

/**
 * One hollow candle. Its body is hollow when the bar closed at or above its own open and filled
 * otherwise, while its colour comes from the direction the bar took against the previous close.
 */
function hollowCandlePoint(
  appearance: HollowCandlesAppearance,
  bar: RenderBar,
  previous: RenderBar | undefined,
): CandlestickData<Time> {
  const { body, borders, wick } = appearance.candles;
  const rising = roseAgainstPreviousClose(bar, previous);
  const filled = !roseTo(bar, bar.open);
  return {
    time: bar.time as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    color: filled ? paintedColor(body, rising) : TRANSPARENT,
    // A hidden border leaves the body colour to outline the hole, so a hollow candle stays visible.
    borderColor: borders.visible ? directionColor(borders, rising) : directionColor(body, rising),
    wickColor: wick.visible ? directionColor(wick, rising) : TRANSPARENT,
  };
}

function barsPoint(appearance: BarsAppearance, bar: RenderBar, previous: RenderBar | undefined): BarData<Time> {
  return {
    time: bar.time as UTCTimestamp,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    color: barColor(bar, previous, appearance),
  };
}

/** A column stands for the bar's close, coloured by the direction its style was saved with. */
function columnsPoint(
  appearance: ColumnsAppearance,
  bar: RenderBar,
  previous: RenderBar | undefined,
): HistogramData<Time> {
  return { time: bar.time as UTCTimestamp, value: bar.close, color: barColor(bar, previous, appearance) };
}

/** The point one bar plots in `appearance`'s style, for the styles a series of its own draws. */
export function barStylePoint(
  appearance: DrawnBarStyleAppearance,
  bar: RenderBar,
  previous: RenderBar | undefined,
): BarStylePoint {
  switch (appearance.style) {
    case 'hollowCandles':
      return hollowCandlePoint(appearance, bar, previous);
    case 'bars':
      return barsPoint(appearance, bar, previous);
    case 'columns':
      return columnsPoint(appearance, bar, previous);
    case 'line':
    case 'lineWithMarkers':
    case 'stepLine':
    case 'area':
      return valuePoint(bar, appearance.priceSource);
  }
}

/** Every bar's point in `appearance`'s style; the bar before each one decides the colours it takes. */
export function barStylePoints(appearance: DrawnBarStyleAppearance, bars: readonly RenderBar[]): BarStylePoint[] {
  return bars.map((bar, index) => barStylePoint(appearance, bar, bars[index - 1]));
}
