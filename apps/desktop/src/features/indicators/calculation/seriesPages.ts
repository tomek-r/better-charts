import { timeframeSeconds } from '../../../shared/bridge/timeframes';
import type { RenderBar } from '../../chart/engine/bars/renderBar';
import { isHigherTimeframe } from './calculationChoice';

/** The most candles one request may ask for: the bridge's own history page bound. */
export const SERIES_PAGE_BARS = 1000;

/** The most pages a lower-timeframe read walks back before it accepts a shorter range than the chart's. */
export const SERIES_MAX_PAGES = 5;

/**
 * Bars of the calculation timeframe the plugin's state needs before its first value is right: longer than the
 * deepest built-in lookback (MACD's slow average and its signal), with room for a longer moving average.
 */
export const SERIES_WARMUP_BARS = 200;

/** One bar for each end of the range, which the oldest and the newest timeframe bar only partly cover. */
const EDGE_BARS = 1;
const MILLISECONDS_PER_SECOND = 1000;

/** The seconds the chart's loaded bars span, the one still forming included. */
export function chartRangeSeconds(chartBars: readonly RenderBar[], chartTimeframe: string): number {
  const oldest = chartBars[0];
  const newest = chartBars.at(-1);
  if (oldest === undefined || newest === undefined) {
    return timeframeSeconds(chartTimeframe);
  }
  return newest.time - oldest.time + timeframeSeconds(chartTimeframe);
}

/** The candles of `timeframe` that cover `rangeSeconds` of chart bars and the plugin's warm-up. */
export function seriesCandlesCovering(rangeSeconds: number, timeframe: string): number {
  return Math.ceil(rangeSeconds / timeframeSeconds(timeframe)) + EDGE_BARS + SERIES_WARMUP_BARS;
}

/** The candles one request asks for: never none, and never more than a page. */
export function seriesPageBars(candles: number): number {
  return Math.min(SERIES_PAGE_BARS, Math.max(1, Math.ceil(candles)));
}

/** The page sizes a read of `candles` candles asks for, newest first, no more than the read may walk back. */
export function seriesPageSizes(candles: number): readonly number[] {
  const sizes: number[] = [];
  let candlesLeft = candles;
  while (candlesLeft > 0 && sizes.length < SERIES_MAX_PAGES) {
    const bars = seriesPageBars(candlesLeft);
    sizes.push(bars);
    candlesLeft -= bars;
  }
  return sizes;
}

/**
 * The candles a read asks for: one newest page, or pages walking back until they reach the oldest chart candle —
 * which a higher timeframe's read never needs, because its bars are longer than the chart's.
 */
export type SeriesReadPlan =
  | { readonly kind: 'newest'; readonly timeframe: string; readonly pages: readonly number[] }
  | {
      readonly kind: 'paged';
      readonly timeframe: string;
      readonly pages: readonly number[];
      /** The oldest chart candle in epoch milliseconds: a page reaching it ends the walk. */
      readonly oldestMs: number;
    };

/** What a read of `timeframe` for the chart's loaded bars asks for. */
export function seriesReadPlan(
  chartBars: readonly RenderBar[],
  chartTimeframe: string,
  timeframe: string,
): SeriesReadPlan {
  const candles = seriesCandlesCovering(chartRangeSeconds(chartBars, chartTimeframe), timeframe);
  if (isHigherTimeframe(timeframe, chartTimeframe)) {
    return { kind: 'newest', timeframe, pages: [seriesPageBars(candles)] };
  }
  const oldest = chartBars[0]?.time ?? 0;
  return { kind: 'paged', timeframe, pages: seriesPageSizes(candles), oldestMs: oldest * MILLISECONDS_PER_SECOND };
}
