import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { ChartIndicator } from '../../chart/engine/indicators/indicatorContract';
import type { IndicatorFrame } from '../../chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { timeframeSeconds } from '../../../shared/bridge/timeframes';
import { projectFrameBars } from '../indicatorFrameBars';
import type { TickCalculationMode } from './calculationChoice';
import { bucketBars, bucketIndexesOf, newestBucketIndex, withFormingBucket } from './higherTimeframeBars';
import { projectHigherTimeframeFrame, type HigherTimeframeSource } from './higherTimeframeFrame';
import { shownLowerBars, type LowerTimeframeSource } from './lowerTimeframeFrame';
import type { TickBarSeries } from './tickBars';
import { shownTickBars, type TickBarSource } from './tickFrame';

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

/**
 * The plugin's indicator calculated on `bars`, its own timeframe's, and written onto the chart's bars: each
 * chart bar carries the values of the bar `shownOf` names for it.
 */
function projectedCalculation(
  { indicator, settings, chartBars }: CalculationInputs,
  bars: readonly RenderBar[],
  barTimeframe: string,
  shownOf: readonly number[],
): TimeframeCalculation {
  const frame = indicator.load(bars, settings, barTimeframe);
  return {
    frame: { ...frame, bars: projectFrameBars(frame, chartBars, (index) => shownOf[index]) },
    liveFrom: chartBars.length - 1,
  };
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
  inputs: CalculationInputs,
  timeframe: string,
  bars: readonly RenderBar[],
  source: LowerTimeframeSource,
): TimeframeCalculation {
  const shownOf = shownLowerBars(bars, inputs.chartBars, timeframeSeconds(inputs.chartTimeframe), source);
  return projectedCalculation(inputs, bars, timeframe, shownOf);
}

/**
 * The plugin's indicator calculated on the N-tick bars read so far: every chart bar shows the last tick bar that
 * ended inside it, or, under the wait switch, the last one that has all its ticks.
 */
export function tickSeriesCalculation(
  inputs: CalculationInputs,
  series: TickBarSeries,
  mode: TickCalculationMode,
  source: TickBarSource,
): TimeframeCalculation {
  const shownOf = shownTickBars(series, inputs.chartBars, timeframeSeconds(inputs.chartTimeframe), source);
  return projectedCalculation(inputs, series.bars, mode.label, shownOf);
}
