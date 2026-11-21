import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { IndicatorBar, IndicatorFrame } from '../../chart/engine/indicators/indicatorFrame';
import { indicatorFrameBar } from '../indicatorFrameBars';

/** Which higher-timeframe bar a chart bar takes its values from. */
export type HigherTimeframeSource =
  /** The bar of the bucket the chart bar falls in, the forming one included. */
  | 'its-bucket'
  /** The last bucket that closed: the line steps only when a higher-timeframe bar closes. */
  | 'last-closed-bucket';

/** The chart's bars and the higher-timeframe bucket each one falls in. */
export interface HigherTimeframeChartBars {
  readonly chartBars: readonly RenderBar[];
  /** For every chart bar, the index of the higher-timeframe bar it falls in. */
  readonly bucketOf: readonly number[];
}

/** The bucket a chart bar reads its values from: its own, or the one that closed before it. */
function sourceBucketOf(bucketIndex: number, source: HigherTimeframeSource): number {
  return source === 'its-bucket' ? bucketIndex : bucketIndex - 1;
}

/**
 * The values of a higher-timeframe frame written onto the chart's bars: one bar per chart bar, carrying the
 * values and colours of the higher-timeframe bar `source` names, and no value while no such bar has closed.
 */
export function projectHigherTimeframeFrame(
  frame: IndicatorFrame,
  chart: HigherTimeframeChartBars,
  source: HigherTimeframeSource,
): readonly IndicatorBar[] {
  const missingValues: readonly null[] = frame.plots.map(() => null);
  const formingIndex = chart.chartBars.length - 1;
  return chart.chartBars.map((chartBar, index) => {
    const bucketBar = frame.bars[sourceBucketOf(chart.bucketOf[index], source)];
    return indicatorFrameBar(chartBar, bucketBar?.values ?? missingValues, index !== formingIndex, bucketBar?.colors);
  });
}
