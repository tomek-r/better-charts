import { MismatchDirection, type IChartApi, type IPriceLine, type UTCTimestamp } from 'lightweight-charts';
import type { ChartIndicatorPane } from './indicatorContract';
import { IndicatorFillPrimitive } from './indicatorFillPrimitive';
import type {
  IndicatorBar,
  IndicatorFill,
  IndicatorFillEdge,
  IndicatorFrame,
  IndicatorLevel,
  IndicatorPlot,
} from './indicatorFrame';
import { createLevelLines, removeLevelLines, setLevelLinesHidden } from './indicatorLevels';
import {
  PRICE_PANE_INDEX,
  addOwnPane,
  paneIndexOf,
  pricePaneStretchFactor,
  removeOwnPane,
  type OwnPane,
} from './indicatorPanes';
import {
  addPlotSeries,
  isHistogramPlotSeries,
  isValuePoint,
  plotColorOf,
  plotStateOf,
  removePlotSeries,
  setPlotSeriesHidden,
  type IndicatorPlotPoint,
  type IndicatorPlotSeries,
  type IndicatorPlotState,
} from './indicatorPlotSeries';

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
  readonly plots: readonly IndicatorPlotState[];
  readonly levels: readonly IndicatorLevelState[];
  readonly fills: readonly IndicatorFillState[];
  /** The pane its first plot series is in: the price pane for an overlay, its own pane otherwise. */
  readonly paneIndex: number;
  /** Its own pane's height relative to the price pane; null for an overlay. */
  readonly paneHeight: number | null;
  /** Decimals its values are written with; null when the frame states none. */
  readonly precision: number | null;
}

/** How tall one indicator's own pane is: its stretch factor over the price pane's, so the price pane's stays 1. */
export interface IndicatorPaneHeight {
  readonly instanceId: string;
  readonly paneHeight: number;
}

/** One plot's value at one bar and the colour it is drawn in. */
export interface IndicatorLegendValue {
  readonly value: number | null;
  readonly color: string;
}

/** What a caller says about drawing a frame, beyond the frame itself. */
export interface IndicatorShowOptions {
  /** Whether each visible plot writes its last value on the price scale. */
  readonly priceLabelsVisible: boolean;
  /**
   * The height an indicator's own pane was saved with, relative to the price pane. It sizes a pane the layer
   * does not hold yet; an overlay, or a pane the layer already holds, is left at the height it has.
   */
  readonly paneHeight?: number;
}

/** A caller that says nothing about a frame gets no price labels, the default the labels switch carries. */
const DEFAULT_SHOW_OPTIONS: IndicatorShowOptions = { priceLabelsVisible: false };

/**
 * What the layer holds for one shown indicator: one series per plot, the lines and fills the frame
 * added to them, the titles and the switch of each plot it was shown with, the pane of its own it
 * keeps while it is shown, and the decimals it writes its values with.
 */
interface Shown {
  series: IndicatorPlotSeries[];
  titles: string[];
  plotVisible: boolean[];
  lastTimeSeconds: number | null;
  hidden: boolean;
  levels: readonly IndicatorLevel[];
  levelLines: IPriceLine[];
  fills: readonly IndicatorFill[];
  fillPrimitive: IndicatorFillPrimitive | null;
  ownPane: OwnPane | null;
  precision: number | null;
}

/** The chart's bar time of an indicator bar: the UTC seconds every series point is keyed by. */
function timeOf(bar: IndicatorBar): UTCTimestamp {
  return Math.floor(bar.timeMs / 1000) as UTCTimestamp;
}

/**
 * One bar's point for one plot: a value the plot draws, a time-only whitespace point that breaks it,
 * or no point at all when the plot joins across a missing value.
 */
function pointOf(bar: IndicatorBar, plot: IndicatorPlot, plotIndex: number): IndicatorPlotPoint | null {
  const time = timeOf(bar);
  const value = bar.values[plotIndex];
  if (value === null || !Number.isFinite(value)) {
    return plot.gaps === 'connect' ? null : { time };
  }
  // An area shades one colour, so it takes no per-bar colour.
  const color = plot.style === 'area' ? undefined : bar.colors?.[plotIndex];
  return typeof color === 'string' ? { time, value, color } : { time, value };
}

/** One plot's whole data: a bar without a value is left out where the plot joins across it. */
function pointsOf(bars: readonly IndicatorBar[], plot: IndicatorPlot, plotIndex: number): IndicatorPlotPoint[] {
  const points: IndicatorPlotPoint[] = [];
  for (const bar of bars) {
    const point = pointOf(bar, plot, plotIndex);
    if (point !== null) {
      points.push(point);
    }
  }
  return points;
}

/**
 * The legend's value for one plot at the bar with `logicalIndex`: the plot's own colour where its
 * point carries one, and no value where the plot has no point (a whitespace bar or a bar before it).
 */
function legendValueOf(series: IndicatorPlotSeries, logicalIndex: number): IndicatorLegendValue {
  const color = plotColorOf(series);
  if (logicalIndex < 0) {
    return { value: null, color };
  }
  const point = series.dataByIndex(logicalIndex, MismatchDirection.None);
  if (point === null || !isValuePoint(point)) {
    return { value: null, color };
  }
  return { value: point.value, color: point.color ?? color };
}

function levelStateOf(level: IndicatorLevel): IndicatorLevelState {
  return { title: level.title, price: level.price, color: level.color, visible: level.visible !== false };
}

function fillStateOf(fill: IndicatorFill): IndicatorFillState {
  return { from: fill.from, to: fill.to, color: fill.color };
}

/**
 * The series the levels and the fill hang on: the first line plot, or the first series when every
 * plot draws columns. A switched-off histogram hides its whole series, so a level hung on it would
 * go with the columns.
 */
function hostSeriesOf(series: readonly IndicatorPlotSeries[]): IndicatorPlotSeries | undefined {
  return series.find((plotSeries) => !isHistogramPlotSeries(plotSeries)) ?? series[0];
}

/**
 * The display layer for indicator frames: one series per plot, plus the levels and fills the frame
 * describes. Levels are price lines and fills are a primitive, both hung on the first line plot
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
   * pane of its own, `options` what it says about the frame beside its plots.
   */
  show(
    id: string,
    frame: IndicatorFrame,
    pane: ChartIndicatorPane = 'overlay',
    options: IndicatorShowOptions = DEFAULT_SHOW_OPTIONS,
  ): void {
    const heldPane = this.shown.get(id)?.ownPane ?? null;
    this.clear(id);
    this.draw(id, frame, this.paneToDrawIn(heldPane, pane, options.paneHeight), options);
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
        const point = pointOf(bar, frame.plots[plotIndex], plotIndex);
        if (point !== null) {
          series.update(point);
        }
      }
      shown.lastTimeSeconds = seconds;
    }
  }

  /** Hides or shows every plot, level and fill of `id`; an unknown id does nothing. */
  setHidden(id: string, hidden: boolean): void {
    const shown = this.shown.get(id);
    if (shown === undefined) {
      return;
    }
    shown.hidden = hidden;
    for (const [plotIndex, series] of shown.series.entries()) {
      setPlotSeriesHidden(series, hidden, shown.plotVisible[plotIndex]);
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
      paneHeight: this.paneHeightOf(shown),
      precision: shown.precision,
    }));
  }

  /** The height of every own pane it holds, relative to the price pane, for the app to save. */
  paneHeights(): IndicatorPaneHeight[] {
    const heights: IndicatorPaneHeight[] = [];
    for (const [instanceId, shown] of this.shown) {
      const paneHeight = this.paneHeightOf(shown);
      if (paneHeight !== null) {
        heights.push({ instanceId, paneHeight });
      }
    }
    return heights;
  }

  /** The decimals `id` writes its values with; null for an unknown id or a frame that states none. */
  precisionOf(id: string): number | null {
    return this.shown.get(id)?.precision ?? null;
  }

  /** The element an own-pane indicator's legend row sits in; null for an overlay or an unknown id. */
  paneLegendHost(id: string): HTMLElement | null {
    return this.shown.get(id)?.ownPane?.overlay.element ?? null;
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
  private draw(id: string, frame: IndicatorFrame, ownPane: OwnPane | null, options: IndicatorShowOptions): void {
    // The pane's index is read here rather than when it was added: indices shift when another pane goes.
    const paneIndex = paneIndexOf(ownPane);
    const precision = frame.precision ?? null;
    const series = frame.plots.map((plot, plotIndex) => {
      const plotSeries = addPlotSeries(this.chart, plot, paneIndex, precision, options.priceLabelsVisible);
      plotSeries.setData(pointsOf(frame.bars, plot, plotIndex));
      return plotSeries;
    });
    const lastBar = frame.bars[frame.bars.length - 1];
    const levels = frame.levels ?? [];
    const fills = frame.fills ?? [];
    const hostSeries = hostSeriesOf(series);
    this.shown.set(id, {
      series,
      titles: frame.plots.map((plot) => plot.title),
      plotVisible: frame.plots.map((plot) => plot.visible !== false),
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
      removePlotSeries(this.chart, series);
    }
    this.shown.delete(id);
  }

  /**
   * The pane `id` draws in next: the pane of its own it already holds or a new one, and none for an
   * overlay, which gives a held pane back to the chart. A new pane takes the height the indicator was
   * saved with; a pane already held keeps the one the user gave it.
   */
  private paneToDrawIn(
    heldPane: OwnPane | null,
    pane: ChartIndicatorPane,
    paneHeight: number | undefined,
  ): OwnPane | null {
    if (pane === 'own') {
      return heldPane ?? addOwnPane(this.chart, paneHeight);
    }
    removeOwnPane(this.chart, heldPane);
    return null;
  }

  /** An own pane's height relative to the price pane; null for an overlay. */
  private paneHeightOf(shown: Shown): number | null {
    if (shown.ownPane === null) {
      return null;
    }
    return shown.ownPane.pane.getStretchFactor() / pricePaneStretchFactor(this.chart);
  }

  /** Attaches the fill primitive to the host series, which owns the pane the band is drawn in. */
  private attachFill(
    hostSeries: IndicatorPlotSeries,
    series: readonly IndicatorPlotSeries[],
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

  /** Takes the fill primitive and the level lines off the host series before the series themselves go. */
  private detachExtras(shown: Shown): void {
    const hostSeries = hostSeriesOf(shown.series);
    if (hostSeries === undefined) {
      return;
    }
    if (shown.fillPrimitive !== null) {
      hostSeries.detachPrimitive(shown.fillPrimitive);
    }
    removeLevelLines(hostSeries, shown.levelLines);
  }
}
