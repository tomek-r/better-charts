import {
  LineSeries,
  LineType,
  MismatchDirection,
  type IChartApi,
  type IPaneApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts';
import type { ChartIndicatorPane } from './indicatorContract';
import { IndicatorFillPrimitive } from './indicatorFillPrimitive';
import type {
  IndicatorBar,
  IndicatorFill,
  IndicatorFillEdge,
  IndicatorFrame,
  IndicatorLevel,
  IndicatorLineStyle,
  IndicatorPlot,
} from './indicatorFrame';
import {
  createLevelLines,
  removeLevelLines,
  setLevelLinesHidden,
  toIndicatorLineStyle,
  toLibraryLineStyle,
} from './indicatorLevels';
import { toLineWidth } from './indicatorLineWidth';
import { PRICE_PANE_INDEX, addOwnPane, paneIndexOf, priceFormatOf, removeOwnPane } from './indicatorPanes';

/** One horizontal level as the dev hook shows it. */
export interface IndicatorLevelState {
  readonly title: string;
  readonly price: number;
  readonly color: string;
  readonly visible: boolean;
}

/** One filled band as the dev hook shows it: the two edges it spans, and the colour it is painted in. */
export interface IndicatorFillState {
  readonly from: IndicatorFillEdge;
  readonly to: IndicatorFillEdge;
  readonly color: string;
}

/** Every indicator the layer draws, in the order it was shown, as plain copies of its lines. */
export interface IndicatorLayerState {
  readonly id: string;
  readonly hidden: boolean;
  readonly plots: readonly {
    readonly title: string;
    readonly color: string;
    readonly lineWidth: number;
    readonly lineType: 'simple' | 'step';
    readonly lineStyle: IndicatorLineStyle;
    readonly visible: boolean;
    readonly points: readonly { readonly time: number; readonly value: number; readonly color: string | null }[];
  }[];
  readonly levels: readonly IndicatorLevelState[];
  readonly fills: readonly IndicatorFillState[];
  /** The pane its first plot series is in: the price pane for an overlay, its own pane otherwise. */
  readonly paneIndex: number;
  /** Decimals its values are written with; null when the frame states none. */
  readonly precision: number | null;
}

/** One drawn plot as the dev hook shows it. */
type IndicatorPlotState = IndicatorLayerState['plots'][number];

/** One drawn point as the dev hook shows it: a bar without a value has no point here, as the library keeps whitespace out of `series.data()`. */
type IndicatorPointState = IndicatorPlotState['points'][number];

/**
 * What the layer holds for one shown indicator: one series per plot, the lines and fills the frame
 * added to them, the titles it was shown with, the pane of its own it keeps while it is shown, and
 * the decimals it writes its values with.
 */
interface Shown {
  series: ISeriesApi<'Line'>[];
  titles: string[];
  lastTimeSeconds: number | null;
  hidden: boolean;
  levels: readonly IndicatorLevel[];
  levelLines: IPriceLine[];
  fills: readonly IndicatorFill[];
  fillPrimitive: IndicatorFillPrimitive | null;
  ownPane: IPaneApi<Time> | null;
  precision: number | null;
}

/** The chart's bar time of an indicator bar: the UTC seconds every series point is keyed by. */
function timeOf(bar: IndicatorBar): UTCTimestamp {
  return Math.floor(bar.timeMs / 1000) as UTCTimestamp;
}

/** One bar's point for one plot: a value the line joins, or a time-only whitespace point that breaks it. */
function pointOf(bar: IndicatorBar, plotIndex: number): LineData<Time> | WhitespaceData<Time> {
  const time = timeOf(bar);
  const value = bar.values[plotIndex];
  if (value === null || !Number.isFinite(value)) {
    return { time };
  }
  const color = bar.colors?.[plotIndex];
  return typeof color === 'string' ? { time, value, color } : { time, value };
}

/** The seconds of a point's time; the layer only ever writes `UTCTimestamp` values. */
function secondsOf(time: Time): number {
  return typeof time === 'number' ? time : Number.NaN;
}

function isLinePoint(point: LineData<Time> | WhitespaceData<Time>): point is LineData<Time> {
  return 'value' in point;
}

/** One plot's value at one bar and the colour it is drawn in. */
export interface IndicatorLegendValue {
  readonly value: number | null;
  readonly color: string;
}

/**
 * The legend's value for one plot at the bar with `logicalIndex`: the plot's own colour where its
 * point carries one, and no value where the plot has no point (a whitespace bar or a bar before it).
 */
function legendValueOf(series: ISeriesApi<'Line'>, logicalIndex: number): IndicatorLegendValue {
  const color = series.options().color;
  if (logicalIndex < 0) {
    return { value: null, color };
  }
  const point = series.dataByIndex(logicalIndex, MismatchDirection.None);
  if (point === null || !isLinePoint(point)) {
    return { value: null, color };
  }
  return { value: point.value, color: point.color ?? color };
}

function pointStateOf(point: LineData<Time>): IndicatorPointState {
  return { time: secondsOf(point.time), value: point.value, color: point.color ?? null };
}

function plotStateOf(series: ISeriesApi<'Line'>, title: string): IndicatorPlotState {
  const options = series.options();
  return {
    title,
    color: options.color,
    lineWidth: options.lineWidth,
    lineType: options.lineType === LineType.WithSteps ? 'step' : 'simple',
    lineStyle: toIndicatorLineStyle(options.lineStyle),
    visible: options.lineVisible,
    points: series.data().filter(isLinePoint).map(pointStateOf),
  };
}

function levelStateOf(level: IndicatorLevel): IndicatorLevelState {
  return { title: level.title, price: level.price, color: level.color, visible: level.visible !== false };
}

function fillStateOf(fill: IndicatorFill): IndicatorFillState {
  return { from: fill.from, to: fill.to, color: fill.color };
}

/**
 * The display layer for indicator frames: one line series per plot, plus the levels and fills the
 * frame describes. Levels are price lines and fills are a primitive, both hung on the first plot
 * series, so they share its pane, its price scale and its hide/show. An indicator shown in a pane of
 * its own draws every plot there, keeps that pane across reloads, and gives it back when it is
 * removed.
 */
export class IndicatorLayer {
  private readonly shown = new Map<string, Shown>();

  constructor(private readonly chart: IChartApi) {}

  /**
   * Draws a whole frame for `id`, replacing everything it drew before, including the levels and
   * fills it kept from an earlier frame. A frame without plots draws no levels and no fills: there
   * is no series to hang them on. `pane` says whether the indicator draws on the price pane or in a
   * pane of its own.
   */
  show(id: string, frame: IndicatorFrame, pane: ChartIndicatorPane = 'overlay'): void {
    const heldPane = this.shown.get(id)?.ownPane ?? null;
    this.clear(id);
    this.draw(id, frame, this.paneToDrawIn(heldPane, pane));
  }

  /**
   * Applies a live frame to `id`. A frame for an unknown id, or with another plot count than the
   * one shown, does nothing: the producer shows the whole frame again. Levels and fills are read on
   * `show` only, so a live frame carries them unchanged.
   */
  update(id: string, frame: IndicatorFrame): void {
    const shown = this.shown.get(id);
    if (shown === undefined || shown.series.length !== frame.plots.length) {
      return;
    }
    for (const bar of frame.bars) {
      const seconds = timeOf(bar);
      if (shown.lastTimeSeconds !== null && seconds < shown.lastTimeSeconds) {
        // The library refuses an update older than its last point; a rewritten history arrives as `show`.
        continue;
      }
      for (const [plotIndex, series] of shown.series.entries()) {
        series.update(pointOf(bar, plotIndex));
      }
      shown.lastTimeSeconds = seconds;
    }
  }

  /** Hides or shows every line, level and fill of `id`; an unknown id does nothing. */
  setHidden(id: string, hidden: boolean): void {
    const shown = this.shown.get(id);
    if (shown === undefined) {
      return;
    }
    shown.hidden = hidden;
    for (const series of shown.series) {
      series.applyOptions({ visible: !hidden });
    }
    setLevelLinesHidden(shown.levelLines, shown.levels, hidden);
    shown.fillPrimitive?.setHidden(hidden);
  }

  /** Removes everything `id` drew and gives back the pane it held, if any. */
  remove(id: string): void {
    const heldPane = this.shown.get(id)?.ownPane ?? null;
    this.clear(id);
    removeOwnPane(this.chart, heldPane);
  }

  destroy(): void {
    for (const id of [...this.shown.keys()]) {
      this.remove(id);
    }
  }

  /** Every indicator it draws, in the order it was shown, as plain copies for the dev hook. */
  state(): IndicatorLayerState[] {
    return [...this.shown.entries()].map(([id, shown]) => ({
      id,
      hidden: shown.hidden,
      plots: shown.series.map((series, plotIndex) => plotStateOf(series, shown.titles[plotIndex])),
      levels: shown.levels.map(levelStateOf),
      fills: shown.fills.map(fillStateOf),
      paneIndex: shown.series[0]?.getPane().paneIndex() ?? PRICE_PANE_INDEX,
      precision: shown.precision,
    }));
  }

  /** The decimals `id` writes its values with; null for an unknown id or a frame that states none. */
  precisionOf(id: string): number | null {
    return this.shown.get(id)?.precision ?? null;
  }

  /** Each plot's value at the bar with `logicalIndex`, for the legend; an unknown id has none. */
  valuesAt(id: string, logicalIndex: number): IndicatorLegendValue[] {
    const shown = this.shown.get(id);
    if (shown === undefined) {
      return [];
    }
    return shown.series.map((series) => legendValueOf(series, logicalIndex));
  }

  /** Draws `frame` for `id`, in its own pane or on the price pane when `ownPane` is null. */
  private draw(id: string, frame: IndicatorFrame, ownPane: IPaneApi<Time> | null): void {
    // The pane's index is read here rather than when it was added: indices shift when another pane goes.
    const paneIndex = paneIndexOf(ownPane);
    const precision = frame.precision ?? null;
    const series = frame.plots.map((plot, plotIndex) => {
      const line = this.addPlot(plot, paneIndex, precision);
      line.setData(frame.bars.map((bar) => pointOf(bar, plotIndex)));
      return line;
    });
    const lastBar = frame.bars[frame.bars.length - 1];
    const levels = frame.levels ?? [];
    const fills = frame.fills ?? [];
    const hostSeries = series[0];
    this.shown.set(id, {
      series,
      titles: frame.plots.map((plot) => plot.title),
      lastTimeSeconds: lastBar === undefined ? null : timeOf(lastBar),
      hidden: false,
      levels,
      levelLines: hostSeries === undefined ? [] : createLevelLines(hostSeries, levels),
      fills,
      fillPrimitive: hostSeries === undefined ? null : this.attachFill(hostSeries, series, levels, fills),
      ownPane,
      precision,
    });
  }

  /** Removes every series, level line and fill of `id`; the pane it holds stays with the layer. */
  private clear(id: string): void {
    const shown = this.shown.get(id);
    if (shown === undefined) {
      return;
    }
    this.detachExtras(shown);
    for (const series of shown.series) {
      this.chart.removeSeries(series);
    }
    this.shown.delete(id);
  }

  /**
   * The pane `id` draws in next: the pane of its own it already holds or a new one, and none for an
   * overlay, which gives a held pane back to the chart.
   */
  private paneToDrawIn(heldPane: IPaneApi<Time> | null, pane: ChartIndicatorPane): IPaneApi<Time> | null {
    if (pane === 'own') {
      return heldPane ?? addOwnPane(this.chart);
    }
    removeOwnPane(this.chart, heldPane);
    return null;
  }

  /** Attaches the fill primitive to the first plot series, which owns the pane the band is drawn in. */
  private attachFill(
    hostSeries: ISeriesApi<'Line'>,
    series: readonly ISeriesApi<'Line'>[],
    levels: readonly IndicatorLevel[],
    fills: readonly IndicatorFill[],
  ): IndicatorFillPrimitive | null {
    if (fills.length === 0) {
      return null;
    }
    const primitive = new IndicatorFillPrimitive(series, levels, fills);
    hostSeries.attachPrimitive(primitive);
    return primitive;
  }

  /** Takes the fill primitive and the level lines off the series before the series itself goes. */
  private detachExtras(shown: Shown): void {
    const hostSeries = shown.series[0];
    if (hostSeries === undefined) {
      return;
    }
    if (shown.fillPrimitive !== null) {
      hostSeries.detachPrimitive(shown.fillPrimitive);
    }
    removeLevelLines(hostSeries, shown.levelLines);
  }

  /**
   * Adds one plot's series at `paneIndex`, writing its values with `precision` decimals when the
   * frame states them. A switched-off plot hides only its line, because the levels and fills hang on
   * the first plot's series.
   */
  private addPlot(plot: IndicatorPlot, paneIndex: number | undefined, precision: number | null): ISeriesApi<'Line'> {
    const line = this.chart.addSeries(
      LineSeries,
      {
        color: plot.color,
        lineWidth: toLineWidth(plot.lineWidth),
        lineStyle: toLibraryLineStyle(plot.lineStyle),
        lineType: plot.style === 'stepline' ? LineType.WithSteps : LineType.Simple,
        lineVisible: plot.visible !== false,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
      paneIndex,
    );
    const priceFormat = priceFormatOf(precision);
    if (priceFormat !== undefined) {
      line.applyOptions({ priceFormat });
    }
    return line;
  }
}
