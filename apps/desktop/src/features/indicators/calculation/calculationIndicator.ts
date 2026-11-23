import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { ChartIndicator, ChartIndicatorOutlet } from '../../chart/engine/indicators/indicatorContract';
import type { IndicatorFrame, IndicatorPlot } from '../../chart/engine/indicators/indicatorFrame';
import type { IndicatorTickSource } from '../../chart/engine/indicators/indicatorTickSource';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import {
  calculationModeOf,
  isHigherTimeframe,
  waitsForTimeframeCloses,
  type OffChartCalculation,
  type TickCalculationMode,
} from './calculationChoice';
import type { HigherTimeframeSource } from './higherTimeframeFrame';
import { IndicatorTicksRead } from './indicatorTicksRead';
import type { LowerTimeframeSource } from './lowerTimeframeFrame';
import { seriesReadPlan } from './seriesPages';
import { acquireSeriesRead, dropSeriesReads, type SharedSeriesRead } from './seriesReadCache';
import { buildTickBars, type TickBarSeries } from './tickBars';
import type { TickBarSource } from './tickFrame';
import { tickReadRange } from './tickPages';
import {
  groupedCalculation,
  higherSeriesCalculation,
  lowerSeriesCalculation,
  tickSeriesCalculation,
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

/** Where a chart bar takes its N-tick bars' values from under the wait switch. */
function tickBarSourceOf(settings: SettingValues): TickBarSource {
  return waitsForTimeframeCloses(settings) ? 'last-closed-in-chart-bar' : 'last-in-chart-bar';
}

/** The chart's bars with the live one in it: the forming bar replaced, or a bar opened after it. */
function withLiveBar(bars: readonly RenderBar[], bar: RenderBar): readonly RenderBar[] {
  const formingBar = bars.at(-1);
  return formingBar === undefined || bar.time > formingBar.time ? [...bars, bar] : [...bars.slice(0, -1), bar];
}

/**
 * An indicator calculated on another timeframe than the chart's, or on N-tick bars, read through the chart's
 * sources. A higher timeframe's newest page is projected onto the chart's bars as grouping was, and its forming
 * bar keeps following the chart's live bars; a lower timeframe's candles are paged back over the chart's range,
 * and each chart bar shows the last one inside it; N-tick bars are built from the ticks read back from now, and
 * each chart bar shows the last one that ended inside it. Until the first page arrives a higher timeframe is
 * grouped from the chart's own bars, so nothing flickers empty, and a lower one or a tick calculation has no
 * value yet. Every indicator of a chart that draws the same timeframe shares that chart's one read of it.
 *
 * Settings that name no other timeframe calculate on the chart's own bars, as the plugin does alone.
 */
export class CalculationIndicator implements ChartIndicator {
  private readonly indicator: ChartIndicator;
  private outlet: ChartIndicatorOutlet | null = null;
  private seriesRead: SharedSeriesRead | null = null;
  private ticksRead: IndicatorTicksRead | null = null;
  /** Draws the whole frame again, as the chart's shared read of a timeframe answers this indicator. */
  private readonly drawRead: () => void = () => this.drawReadFrame();
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
    this.startReads(settings);
    return this.wholeFrame(settings);
  }

  update(bar: RenderBar, settings: SettingValues): IndicatorFrame {
    const mode = calculationModeOf(settings, this.chartTimeframe);
    if (mode.kind === 'chart') {
      return this.indicator.update(bar, settings);
    }
    const formingBar = this.chartBars.at(-1);
    if (formingBar === undefined || bar.time < formingBar.time) {
      return { plots: this.plots, bars: [] };
    }
    this.chartBars = withLiveBar(this.chartBars, bar);
    this.followLiveBar(mode, formingBar, bar);
    const calculation = this.calculationOf(mode, settings);
    this.plots = calculation.frame.plots;
    return { ...calculation.frame, bars: calculation.frame.bars.slice(calculation.liveFrom) };
  }

  historyReplaced(): void {
    this.chartBars = [];
    this.plots = [];
    this.dropChartSeriesReads();
    this.stopReads();
    this.indicator.historyReplaced?.();
  }

  dispose(): void {
    this.stopReads();
    this.indicator.dispose?.();
  }

  /** The whole frame for the bars held now, as `load` and a finished read hand it over. */
  private wholeFrame(settings: SettingValues): IndicatorFrame {
    const mode = calculationModeOf(settings, this.chartTimeframe);
    const frame =
      mode.kind === 'chart'
        ? this.indicator.load(this.chartBars, settings, this.chartTimeframe)
        : this.calculationOf(mode, settings).frame;
    this.plots = frame.plots;
    return frame;
  }

  /** Draws the whole frame again once the read answered: its answer arrives after the frame it was asked for. */
  private drawReadFrame(): void {
    this.outlet?.showFrame(this.wholeFrame(this.settings));
  }

  /** The whole calculation off the chart's own bars: the plugin over them, written onto the chart's bars. */
  private calculationOf(mode: OffChartCalculation, settings: SettingValues): TimeframeCalculation {
    const inputs = {
      indicator: this.indicator,
      settings,
      chartBars: this.chartBars,
      chartTimeframe: this.chartTimeframe,
    };
    if (mode.kind === 'ticks') {
      return tickSeriesCalculation(inputs, this.tickBarsOf(mode), mode, tickBarSourceOf(settings));
    }
    const read = this.seriesRead?.timeframe === mode.timeframe ? this.seriesRead : null;
    if (isHigherTimeframe(mode.timeframe, this.chartTimeframe)) {
      // The bucket the chart still draws is grouped from its bars before every frame, the one a finished read
      // hands over included, so the bucket keeps the chart's own value once the chart opens the next one.
      read?.followHigherBars(this.chartBars);
      const source = higherSourceOf(settings);
      const bars = read?.bars ?? [];
      return bars.length === 0
        ? groupedCalculation(inputs, mode.timeframe, source)
        : higherSeriesCalculation(inputs, mode.timeframe, bars, source);
    }
    return lowerSeriesCalculation(inputs, mode.timeframe, read?.bars ?? [], lowerSourceOf(settings));
  }

  /** The N-tick bars of the ticks read so far, which a live chart tick does not change until an answer arrives. */
  private tickBarsOf(mode: TickCalculationMode): TickBarSeries {
    return buildTickBars(this.ticksRead?.heldTicks ?? [], mode.ticksPerBar);
  }

  /** Starts the read the calculation needs, or drops the one the previous settings asked for. */
  private startReads(settings: SettingValues): void {
    const mode = calculationModeOf(settings, this.chartTimeframe);
    if (mode.kind === 'timeframe') {
      this.startSeriesRead(mode.timeframe);
      return;
    }
    if (mode.kind === 'ticks') {
      this.startTicksRead();
      return;
    }
    this.stopReads();
  }

  /**
   * Reads the calculation timeframe's candles through the chart's shared read of it, or drops the ticks the
   * settings no longer read. A read of that timeframe another indicator already started is left as it is.
   */
  private startSeriesRead(timeframe: string): void {
    const source = this.outlet?.seriesSource;
    if (source === undefined) {
      this.stopReads();
      return;
    }
    this.stopTicksRead();
    if (this.seriesRead?.timeframe === timeframe) {
      return;
    }
    this.stopSeriesRead();
    const plan = seriesReadPlan(this.chartBars, this.chartTimeframe, timeframe);
    this.seriesRead = acquireSeriesRead(source, timeframe, plan, this.drawRead);
  }

  /** Starts the read of the chart's raw ticks, or drops the series the settings no longer read. */
  private startTicksRead(): void {
    const source = this.outlet?.tickSource;
    const range = tickReadRange(this.chartBars, this.chartTimeframe);
    if (source === undefined || range === null) {
      this.stopReads();
      return;
    }
    this.stopSeriesRead();
    this.ticksReadOf(source).start(range);
  }

  /** The ticks read, kept while the settings read ticks: a new history walks the chart's range again. */
  private ticksReadOf(source: IndicatorTickSource): IndicatorTicksRead {
    if (this.ticksRead !== null) {
      return this.ticksRead;
    }
    this.ticksRead = new IndicatorTicksRead(source, () => this.drawReadFrame());
    return this.ticksRead;
  }

  private stopReads(): void {
    this.stopSeriesRead();
    this.stopTicksRead();
  }

  private stopSeriesRead(): void {
    this.seriesRead?.release(this.drawRead);
    this.seriesRead = null;
  }

  /** Drops the chart's shared reads, whose candles belong to the history it just replaced. */
  private dropChartSeriesReads(): void {
    const source = this.outlet?.seriesSource;
    if (source !== undefined) {
      dropSeriesReads(source);
    }
  }

  private stopTicksRead(): void {
    this.ticksRead?.dispose();
    this.ticksRead = null;
  }

  /**
   * Follows the live bar: a closed chart bar reads the ticks it added, and a lower timeframe's read takes its
   * forming bar from the chart's own bars, so a live tick asks the host for nothing. A higher timeframe's read
   * follows the chart's bars where the values written onto them are calculated from.
   */
  private followLiveBar(mode: OffChartCalculation, previous: RenderBar, bar: RenderBar): void {
    if (mode.kind === 'ticks') {
      if (bar.time > previous.time) {
        this.extendTicksRead();
      }
      return;
    }
    const read = this.seriesRead;
    if (read === null || isHigherTimeframe(mode.timeframe, this.chartTimeframe)) {
      return;
    }
    read.followLowerBars(this.chartBars, previous);
  }

  /** Reads the ticks a closed chart bar added, from the newest one held up to now. */
  private extendTicksRead(): void {
    const range = tickReadRange(this.chartBars, this.chartTimeframe);
    if (this.ticksRead === null || range === null) {
      return;
    }
    this.ticksRead.extend(range);
  }
}
