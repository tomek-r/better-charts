import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { ChartIndicator } from '../../chart/engine/indicators/indicatorContract';
import type { IndicatorFrame } from '../../chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { timeframeSeconds } from '../../../shared/bridge/timeframes';
import { bucketBars, bucketIndexesOf, newestBucketIndex, withFormingBucket } from './higherTimeframeBars';
import { projectHigherTimeframeFrame, type HigherTimeframeSource } from './higherTimeframeFrame';
import { projectLowerTimeframeFrame, shownLowerBars, type LowerTimeframeSource } from './lowerTimeframeFrame';

/** What a calculation on another timeframe reads: the plugin, its settings, and the chart's own bars. */
export interface CalculationInputs {
  readonly indicator: ChartIndicator;
  readonly settings: SettingValues;
  readonly chartBars: readonly RenderBar[];
  readonly chartTimeframe: string;
}

/**
 * One whole calculation on another timeframe: the frame written onto the chart's bars, and where a live bar
 * starts changing it.
 */
export interface TimeframeCalculation {
  readonly frame: IndicatorFrame;
  /** The first chart bar a live bar can change: the one that opens the newest calculation bar. */
  readonly liveFrom: number;
}

/** The chart's bars grouped into `timeframe`, calculated, and written back onto the chart's bars. */
export function groupedCalculation(
  { indicator, settings, chartBars }: CalculationInputs,
  timeframe: string,
  source: HigherTimeframeSource,
): TimeframeCalculation {
  const buckets = bucketBars(chartBars, timeframe);
  const frame = indicator.load(buckets.bars, settings, timeframe);
  return {
    frame: { ...frame, bars: projectHigherTimeframeFrame(frame, { chartBars, bucketOf: buckets.bucketOf }, source) },
    liveFrom: newestBucketIndex(chartBars, timeframe),
  };
}

/**
 * The plugin's indicator calculated on `timeframe`'s own `bars`, written onto the chart's bars. The newest
 * calculation bar is taken from the chart's own bars, which carry the ticks the read does not.
 */
export function higherSeriesCalculation(
  { indicator, settings, chartBars }: CalculationInputs,
  timeframe: string,
  bars: readonly RenderBar[],
  source: HigherTimeframeSource,
): TimeframeCalculation {
  const calculationBars = withFormingBucket(bars, chartBars, timeframe);
  const bucketOf = bucketIndexesOf(calculationBars, timeframe, chartBars);
  const frame = indicator.load(calculationBars, settings, timeframe);
  return {
    frame: { ...frame, bars: projectHigherTimeframeFrame(frame, { chartBars, bucketOf }, source) },
    liveFrom: newestBucketIndex(chartBars, timeframe),
  };
}

/** The plugin's indicator calculated on `timeframe`'s own `bars`: every chart bar shows the bar it names. */
export function lowerSeriesCalculation(
  { indicator, settings, chartBars, chartTimeframe }: CalculationInputs,
  timeframe: string,
  bars: readonly RenderBar[],
  source: LowerTimeframeSource,
): TimeframeCalculation {
  const frame = indicator.load(bars, settings, timeframe);
  const shownOf = shownLowerBars(bars, chartBars, timeframeSeconds(chartTimeframe), source);
  return {
    frame: { ...frame, bars: projectLowerTimeframeFrame(frame, chartBars, shownOf) },
    liveFrom: chartBars.length - 1,
  };
}
