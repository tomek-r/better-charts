import {
  LineSeries,
  LineType,
  MismatchDirection,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type LineWidth,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts';
import type { IndicatorBar, IndicatorFrame, IndicatorPlot } from './indicatorFrame';

/** The narrowest and widest line the library draws, which every plot's width is clamped to. */
const MIN_LINE_WIDTH = 1;
const MAX_LINE_WIDTH = 4;

/** Every indicator the layer draws, in the order it was shown, as plain copies of its lines. */
export interface IndicatorLayerState {
  readonly id: string;
  readonly hidden: boolean;
  readonly plots: readonly {
    readonly title: string;
    readonly color: string;
    readonly lineWidth: number;
    readonly lineType: 'simple' | 'step';
    readonly points: readonly { readonly time: number; readonly value: number; readonly color: string | null }[];
  }[];
}

/** One drawn plot as the dev hook shows it. */
type IndicatorPlotState = IndicatorLayerState['plots'][number];

/** One drawn point as the dev hook shows it: a bar without a value has no point here, as the library keeps whitespace out of `series.data()`. */
type IndicatorPointState = IndicatorPlotState['points'][number];

/** What the layer holds for one shown indicator: one series per plot, and the titles it was shown with. */
interface Shown {
  series: ISeriesApi<'Line'>[];
  titles: string[];
  lastTimeSeconds: number | null;
  hidden: boolean;
}

/** The chart's bar time of an indicator bar: the UTC seconds every series point is keyed by. */
function timeOf(bar: IndicatorBar): UTCTimestamp {
  return Math.floor(bar.timeMs / 1000) as UTCTimestamp;
}

/** The library draws only widths 1 to 4, so a plot's width is rounded into that range. */
function toLineWidth(width: number): LineWidth {
  if (!Number.isFinite(width)) {
    return MIN_LINE_WIDTH;
  }
  return Math.min(MAX_LINE_WIDTH, Math.max(MIN_LINE_WIDTH, Math.round(width))) as LineWidth;
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
    points: series.data().filter(isLinePoint).map(pointStateOf),
  };
}

/** The display layer for indicator frames: one line series per plot, drawn on the price pane. */
export class IndicatorLayer {
  private readonly shown = new Map<string, Shown>();

  constructor(private readonly chart: IChartApi) {}

  /** Draws a whole frame for `id`, replacing everything it drew before. */
  show(id: string, frame: IndicatorFrame): void {
    this.remove(id);
    const series = frame.plots.map((plot, plotIndex) => {
      const line = this.addPlot(plot);
      line.setData(frame.bars.map((bar) => pointOf(bar, plotIndex)));
      return line;
    });
    const titles = frame.plots.map((plot) => plot.title);
    const lastBar = frame.bars[frame.bars.length - 1];
    this.shown.set(id, {
      series,
      titles,
      lastTimeSeconds: lastBar === undefined ? null : timeOf(lastBar),
      hidden: false,
    });
  }

  /**
   * Applies a live frame to `id`. A frame for an unknown id, or with another plot count than the
   * one shown, does nothing: the producer shows the whole frame again.
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

  /** Hides or shows every line of `id`; an unknown id does nothing. */
  setHidden(id: string, hidden: boolean): void {
    const shown = this.shown.get(id);
    if (shown === undefined) {
      return;
    }
    shown.hidden = hidden;
    for (const series of shown.series) {
      series.applyOptions({ visible: !hidden });
    }
  }

  remove(id: string): void {
    const shown = this.shown.get(id);
    if (shown === undefined) {
      return;
    }
    for (const series of shown.series) {
      this.chart.removeSeries(series);
    }
    this.shown.delete(id);
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
    }));
  }

  /** Each plot's value at the bar with `logicalIndex`, for the legend; an unknown id has none. */
  valuesAt(id: string, logicalIndex: number): IndicatorLegendValue[] {
    const shown = this.shown.get(id);
    if (shown === undefined) {
      return [];
    }
    return shown.series.map((series) => legendValueOf(series, logicalIndex));
  }

  private addPlot(plot: IndicatorPlot): ISeriesApi<'Line'> {
    return this.chart.addSeries(LineSeries, {
      color: plot.color,
      lineWidth: toLineWidth(plot.lineWidth),
      lineType: plot.style === 'stepline' ? LineType.WithSteps : LineType.Simple,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
  }
}
