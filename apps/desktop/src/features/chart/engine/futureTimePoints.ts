import { timeframeBarTime } from '../../../shared/bridge/timeframes';

/**
 * Time-scale padding: the invisible points that let every real candle leave the
 * pane when panning. Pure math with no chart object and no library import, so
 * the formulas stay testable without constructing a chart.
 */

/** Future time points allow every real candle to leave the pane when panning. */
export const MARGIN_BARS = 100;

/** Empty bars kept to the right of the last real bar, matching the follow anchor. */
export const END_MARGIN = 5;

/** Default zoom, in pixels per bar: the chart's initial spacing and what `resetToEnd` restores. */
export const DEFAULT_BAR_SPACING = 10;

/**
 * Points the pane needs past the last real bar: the visible bar count at the
 * current spacing plus a screen of headroom. The `+ 100` headroom already
 * exceeds `MARGIN_BARS` for every non-negative width, so the `Math.max` floor is
 * degenerate and kept only to preserve the original expression; the `0.5`
 * divisor floor keeps a collapsed spacing finite.
 */
export function neededFutureBarCount(width: number, barSpacing: number): number {
  return Math.max(MARGIN_BARS, Math.ceil(width / Math.max(0.5, barSpacing)) + 100);
}

/**
 * Logical index of the right edge of the time scale: the last real bar plus the
 * helper points that extend past it.
 */
export function timeScaleBaseIndex(barCount: number, offset: number): number {
  return barCount - 1 + offset;
}

/**
 * The helper points themselves, one bar apart from the last real bar. They
 * repeat the last close because the series holds real values; its separate price
 * scale and autoscale provider keep them out of the price fit.
 */
export function futurePoints(
  lastBarTimeSeconds: number,
  timeframe: string,
  lastClose: number,
  count: number,
): { time: number; value: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    time: timeframeBarTime(timeframe, lastBarTimeSeconds, i + 1),
    value: lastClose,
  }));
}
