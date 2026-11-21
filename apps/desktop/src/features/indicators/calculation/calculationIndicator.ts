import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { ChartIndicator, ChartIndicatorOutlet } from '../../chart/engine/indicators/indicatorContract';
import type { IndicatorFrame, IndicatorPlot } from '../../chart/engine/indicators/indicatorFrame';
import type { IndicatorSeriesSource } from '../../chart/engine/indicators/indicatorSeriesSource';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { calculationTimeframeFor, isHigherTimeframe, waitsForTimeframeCloses } from './calculationChoice';
import { higherTimeframeBarTime } from './higherTimeframeBars';
import type { HigherTimeframeSource } from './higherTimeframeFrame';
import { IndicatorSeriesRead } from './indicatorSeriesRead';
import type { LowerTimeframeSource } from './lowerTimeframeFrame';
import { seriesReadPlan } from './seriesPages';
import {
  groupedCalculation,
  higherSeriesCalculation,
  lowerSeriesCalculation,
  type TimeframeCalculation,
} from './timeframeCalculation';

/** What a plugin's indicator class is, as the wrapper constructs one for itself. */
export type ChartIndicatorClass = new () => ChartIndicator;

/** Where a chart bar takes its higher-timeframe values from under the wait switch. */
function higherSourceOf(settings: SettingValues): HigherTimeframeSource {
  return waitsForTimeframeCloses(settings) ? 'last-closed-bucket' : 'its-bucket';
}

/** Where a chart bar takes its lower-timeframe value from under the wait switch. */
function lowerSourceOf(settings: SettingValues): LowerTimeframeSource {
  return waitsForTimeframeCloses(settings) ? 'last-closed-in-chart-bar' : 'last-in-chart-bar';
}

/** The chart's bars with the live one in it: the forming bar replaced, or a bar opened after it. */
function withLiveBar(bars: readonly RenderBar[], bar: RenderBar): readonly RenderBar[] {
  const formingBar = bars.at(-1);
  return formingBar === undefined || bar.time > formingBar.time ? [...bars, bar] : [...bars.slice(0, -1), bar];
}

/**
 * An indicator calculated on another timeframe than the chart's, read through the chart's series source. A
 * higher timeframe's newest page is projected onto the chart's bars as grouping was, and its forming bar keeps
 * following the chart's live bars; a lower timeframe's candles are paged back over the chart's range, and each
 * chart bar shows the last one inside it. Until the first page arrives a higher timeframe is grouped from the
 * chart's own bars, so nothing flickers empty, and a lower one has no value yet.
 *
 * Settings that name no other timeframe calculate on the chart's own bars, as the plugin does alone.
 */
export class CalculationIndicator implements ChartIndicator {
  private readonly indicator: ChartIndicator;
  private outlet: ChartIndicatorOutlet | null = null;
  private read: IndicatorSeriesRead | null = null;
  /** The chart's bars with the live one in it: every calculation is written onto these. */
  private chartBars: readonly RenderBar[] = [];
  private chartTimeframe = '';
  private settings: SettingValues = {};
  /** The plots of the last whole frame, which a live bar that changes no value draws again. */
  private plots: readonly IndicatorPlot[] = [];

  constructor(indicatorClass: ChartIndicatorClass) {
    this.indicator = new indicatorClass();
  }

  connect(outlet: ChartIndicatorOutlet): void {
    this.outlet = outlet;
  }

  load(bars: readonly RenderBar[], settings: SettingValues, chartTimeframe: string): IndicatorFrame {
    this.chartBars = [...bars];
    this.chartTimeframe = chartTimeframe;
    this.settings = settings;
    this.startRead(settings);
    return this.wholeFrame(settings);
  }

  update(bar: RenderBar, settings: SettingValues): IndicatorFrame {
    const timeframe = calculationTimeframeFor(settings, this.chartTimeframe);
    if (timeframe === undefined) {
      return this.indicator.update(bar, settings);
    }
    const formingBar = this.chartBars.at(-1);
    if (formingBar === undefined || bar.time < formingBar.time) {
      return { plots: this.plots, bars: [] };
    }
    this.chartBars = withLiveBar(this.chartBars, bar);
    this.followLiveBar(formingBar, bar, timeframe);
    const calculation = this.calculationOn(timeframe, settings);
    this.plots = calculation.frame.plots;
    return { ...calculation.frame, bars: calculation.frame.bars.slice(calculation.liveFrom) };
  }

  historyReplaced(): void {
    this.chartBars = [];
    this.plots = [];
    this.stopRead();
    this.indicator.historyReplaced?.();
  }

  dispose(): void {
    this.stopRead();
    this.indicator.dispose?.();
  }

  /** The whole frame for the bars held now, as `load` and a finished read hand it over. */
  private wholeFrame(settings: SettingValues): IndicatorFrame {
    const timeframe = calculationTimeframeFor(settings, this.chartTimeframe);
    const frame =
      timeframe === undefined
        ? this.indicator.load(this.chartBars, settings, this.chartTimeframe)
        : this.calculationOn(timeframe, settings).frame;
    this.plots = frame.plots;
    return frame;
  }

  /** Draws the whole frame again once the read has candles: its answer arrives after the frame it was asked for. */
  private drawReadFrame(): void {
    this.outlet?.showFrame(this.wholeFrame(this.settings));
  }

  /** The whole calculation on `timeframe`: the plugin over its bars, written onto the chart's bars. */
  private calculationOn(timeframe: string, settings: SettingValues): TimeframeCalculation {
    const inputs = {
      indicator: this.indicator,
      settings,
      chartBars: this.chartBars,
      chartTimeframe: this.chartTimeframe,
    };
    const bars = this.read?.timeframe === timeframe ? this.read.bars : [];
    if (isHigherTimeframe(timeframe, this.chartTimeframe)) {
      const source = higherSourceOf(settings);
      return bars.length === 0
        ? groupedCalculation(inputs, timeframe, source)
        : higherSeriesCalculation(inputs, timeframe, bars, source);
    }
    return lowerSeriesCalculation(inputs, timeframe, bars, lowerSourceOf(settings));
  }

  /** Starts the read of the calculation timeframe's candles, or drops the one the previous settings asked for. */
  private startRead(settings: SettingValues): void {
    const timeframe = calculationTimeframeFor(settings, this.chartTimeframe);
    const source = this.outlet?.seriesSource;
    if (timeframe === undefined || source === undefined) {
      this.stopRead();
      return;
    }
    this.readOf(source, timeframe).start(seriesReadPlan(this.chartBars, this.chartTimeframe, timeframe));
  }

  /** The read serving `timeframe`, kept while it already reads it: a new history asks it again. */
  private readOf(source: IndicatorSeriesSource, timeframe: string): IndicatorSeriesRead {
    if (this.read?.timeframe === timeframe) {
      return this.read;
    }
    this.stopRead();
    this.read = new IndicatorSeriesRead(source, () => this.drawReadFrame());
    return this.read;
  }

  private stopRead(): void {
    this.read?.dispose();
    this.read = null;
  }

  /** Asks for the newest candles when a calculation bar closed, or, on a live tick, at most every two seconds. */
  private followLiveBar(previous: RenderBar, bar: RenderBar, timeframe: string): void {
    const read = this.read;
    if (read === null) {
      return;
    }
    const closedCalculationBar =
      higherTimeframeBarTime(timeframe, bar.time) !== higherTimeframeBarTime(timeframe, previous.time);
    if (closedCalculationBar) {
      read.refresh();
      return;
    }
    if (!isHigherTimeframe(timeframe, this.chartTimeframe)) {
      // A higher timeframe's forming bar follows the chart's own bars, so a tick asks for nothing.
      read.refreshLive();
    }
  }
}
