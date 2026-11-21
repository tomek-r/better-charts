import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { ChartIndicator } from '../../chart/engine/indicators/indicatorContract';
import type { IndicatorBar, IndicatorFrame } from '../../chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { higherTimeframeFor, waitsForTimeframeCloses } from './calculationChoice';
import { bucketBars, type HigherTimeframeBars } from './higherTimeframeBars';
import { projectHigherTimeframeFrame, type HigherTimeframeSource } from './higherTimeframeFrame';

/** What a plugin's indicator class is, as the wrapper constructs one for itself. */
export type ChartIndicatorClass = new () => ChartIndicator;

/** One calculation over a higher timeframe: the bars the chart's were grouped into, and the frame they gave. */
interface HigherTimeframeRun {
  readonly timeframe: string;
  readonly buckets: HigherTimeframeBars;
  readonly frame: IndicatorFrame;
}

/** Where a chart bar takes its values from under the wait switch. */
function sourceOf(settings: SettingValues): HigherTimeframeSource {
  return waitsForTimeframeCloses(settings) ? 'last-closed-bucket' : 'its-bucket';
}

/** The chart's bars with the live one in it: the forming bar replaced, or a bar opened after it. */
function withLiveBar(bars: readonly RenderBar[], bar: RenderBar): readonly RenderBar[] {
  const formingBar = bars.at(-1);
  return formingBar === undefined || bar.time > formingBar.time ? [...bars, bar] : [...bars.slice(0, -1), bar];
}

/** The frame bars of the newest bucket, which is the only bucket a live bar can change. */
function newestBucketBars(buckets: HigherTimeframeBars, bars: readonly IndicatorBar[]): readonly IndicatorBar[] {
  const firstIndex = buckets.bucketOf.indexOf(buckets.bars.length - 1);
  return firstIndex < 0 ? [] : bars.slice(firstIndex);
}

/**
 * An indicator calculated on a higher timeframe than the chart's: the chart's bars are grouped into that
 * timeframe's bars, the plugin's own indicator calculates over them, and the result is projected back onto the
 * chart's bars. Settings that name no higher timeframe calculate on the chart's own bars, as the plugin does
 * alone.
 *
 * The wrapper hands the engine no outlet, because a frame an indicator pushes would be a higher-timeframe one:
 * every built-in indicator computes the frames it is loaded with.
 */
export class HigherTimeframeIndicator implements ChartIndicator {
  private readonly indicator: ChartIndicator;
  /** The chart's own bars with the live bar put in: what the higher-timeframe bars are grouped from. */
  private chartBars: readonly RenderBar[] = [];
  /** What the last load calculated over a higher timeframe; null while it calculates on the chart's bars. */
  private run: HigherTimeframeRun | null = null;

  constructor(indicatorClass: ChartIndicatorClass) {
    this.indicator = new indicatorClass();
  }

  load(bars: readonly RenderBar[], settings: SettingValues, chartTimeframe: string): IndicatorFrame {
    this.chartBars = [...bars];
    const timeframe = higherTimeframeFor(settings, chartTimeframe);
    if (timeframe === undefined) {
      this.run = null;
      return this.indicator.load(bars, settings, chartTimeframe);
    }
    const run = this.calculate(settings, timeframe);
    this.run = run;
    return this.project(run, settings);
  }

  update(bar: RenderBar, settings: SettingValues): IndicatorFrame {
    const shown = this.run;
    if (shown === null) {
      return this.indicator.update(bar, settings);
    }
    const formingBar = this.chartBars.at(-1);
    if (formingBar === undefined || bar.time < formingBar.time) {
      return { plots: shown.frame.plots, bars: [] };
    }
    // One live bar can change every chart bar of its bucket, so the buckets and the frame are rebuilt.
    this.chartBars = withLiveBar(this.chartBars, bar);
    const run = this.calculate(settings, shown.timeframe);
    this.run = run;
    const frame = this.project(run, settings);
    return { ...frame, bars: newestBucketBars(run.buckets, frame.bars) };
  }

  historyReplaced(): void {
    this.chartBars = [];
    this.run = null;
    this.indicator.historyReplaced?.();
  }

  dispose(): void {
    this.indicator.dispose?.();
  }

  /** Groups the chart's bars again and calculates the plugin's indicator over them. */
  private calculate(settings: SettingValues, timeframe: string): HigherTimeframeRun {
    const buckets = bucketBars(this.chartBars, timeframe);
    const frame = this.indicator.load(buckets.bars, settings, timeframe);
    return { timeframe, buckets, frame };
  }

  /** The plugin's frame, its values written onto one bar per chart bar. */
  private project(run: HigherTimeframeRun, settings: SettingValues): IndicatorFrame {
    const bars = projectHigherTimeframeFrame(
      run.frame,
      { chartBars: this.chartBars, bucketOf: run.buckets.bucketOf },
      sourceOf(settings),
    );
    return { ...run.frame, bars };
  }
}
