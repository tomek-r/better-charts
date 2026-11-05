import {
  HistogramSeries,
  LineSeries,
  LineType,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesType,
  type Time,
  type WhitespaceData,
} from 'lightweight-charts';
import type { IndicatorLineStyle, IndicatorPlot } from './indicatorFrame';
import { toIndicatorLineStyle, toLibraryLineStyle } from './indicatorLevels';
import { toLineWidth } from './indicatorLineWidth';
import { priceFormatOf } from './indicatorPanes';

/** The library's own name for its column series, which `seriesType()` reports back. */
const HISTOGRAM_SERIES_TYPE = 'Histogram';

/** Columns grow out of zero: the bar's value is the column's height above the scale's base price. */
const HISTOGRAM_BASE = 0;

/** Columns have no stroke, so they report the thinnest width the legend can still paint a swatch in. */
const HISTOGRAM_LINE_WIDTH = 1;

/** One plot's series: a line joining its points, or columns drawn from zero. */
export type IndicatorPlotSeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;

/** How a drawn plot is drawn, as the dev hook reports it. */
export type IndicatorLineType = 'simple' | 'step' | 'histogram';

/** A point as the library holds it: a value to draw, or the time-only gap that breaks the plot. */
export type IndicatorPlotPoint = LineData<Time> | WhitespaceData<Time> | HistogramData<Time>;

/**
 * One drawn point as the dev hook shows it: a bar without a value has no point here, as the library
 * keeps whitespace out of `series.data()`.
 */
export interface IndicatorPointState {
  readonly time: number;
  readonly value: number;
  readonly color: string | null;
}

/** One drawn plot as the dev hook shows it. */
export interface IndicatorPlotState {
  readonly title: string;
  readonly color: string;
  readonly lineWidth: number;
  readonly lineType: IndicatorLineType;
  readonly lineStyle: IndicatorLineStyle;
  readonly visible: boolean;
  readonly points: readonly IndicatorPointState[];
}

/**
 * Adds one plot's series at `paneIndex`, writing its values with `precision` decimals when the frame
 * states them. A line plot draws a line, its own switch deciding whether the line is drawn at all; a
 * histogram plot draws its values as columns from zero.
 */
export function addPlotSeries(
  chart: IChartApi,
  plot: IndicatorPlot,
  paneIndex: number | undefined,
  precision: number | null,
): IndicatorPlotSeries {
  if (plot.style === 'histogram') {
    return withPriceFormat(chart.addSeries(HistogramSeries, histogramOptionsOf(plot), paneIndex), precision);
  }
  return withPriceFormat(chart.addSeries(LineSeries, lineOptionsOf(plot), paneIndex), precision);
}

/** Whether `series` draws columns from zero rather than a line. */
export function isHistogramPlotSeries(series: IndicatorPlotSeries): series is ISeriesApi<'Histogram'> {
  return series.seriesType() === HISTOGRAM_SERIES_TYPE;
}

/**
 * Shows or hides one plot's series. A histogram hides its whole series, while a line keeps its series
 * and hides only the line, so the levels and the fill it carries stay on the chart.
 */
export function setPlotSeriesHidden(series: IndicatorPlotSeries, hidden: boolean, plotVisible: boolean): void {
  if (isHistogramPlotSeries(series)) {
    series.applyOptions({ visible: !hidden && plotVisible });
    return;
  }
  series.applyOptions({ visible: !hidden });
}

/** Whether `point` draws a value rather than marking the gap that breaks the plot. */
export function isValuePoint(point: IndicatorPlotPoint): point is LineData<Time> | HistogramData<Time> {
  return 'value' in point;
}

/** One plot as the dev hook shows it, read back out of its series. */
export function plotStateOf(series: IndicatorPlotSeries, title: string): IndicatorPlotState {
  return isHistogramPlotSeries(series) ? histogramStateOf(series, title) : lineStateOf(series, title);
}

/** The options a line plot's series is created with; `lineVisible` is the plot's own switch. */
function lineOptionsOf(plot: IndicatorPlot) {
  return {
    color: plot.color,
    lineWidth: toLineWidth(plot.lineWidth),
    lineStyle: toLibraryLineStyle(plot.lineStyle),
    lineType: plot.style === 'stepline' ? LineType.WithSteps : LineType.Simple,
    lineVisible: plot.visible !== false,
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  };
}

/**
 * The options a histogram plot's series is created with: one colour for every column, unless a bar
 * carries a colour of its own.
 */
function histogramOptionsOf(plot: IndicatorPlot) {
  return {
    color: plot.color,
    base: HISTOGRAM_BASE,
    priceLineVisible: false,
    lastValueVisible: false,
    visible: plot.visible !== false,
  };
}

/** `series` writing its values with `precision` decimals when the frame states them. */
function withPriceFormat<TSeries extends SeriesType>(
  series: ISeriesApi<TSeries>,
  precision: number | null,
): ISeriesApi<TSeries> {
  const priceFormat = priceFormatOf(precision);
  if (priceFormat !== undefined) {
    series.applyOptions({ priceFormat });
  }
  return series;
}

function lineStateOf(series: ISeriesApi<'Line'>, title: string): IndicatorPlotState {
  const options = series.options();
  return {
    title,
    color: options.color,
    lineWidth: options.lineWidth,
    lineType: options.lineType === LineType.WithSteps ? 'step' : 'simple',
    lineStyle: toIndicatorLineStyle(options.lineStyle),
    visible: options.lineVisible,
    points: pointStatesOf(series.data()),
  };
}

function histogramStateOf(series: ISeriesApi<'Histogram'>, title: string): IndicatorPlotState {
  const options = series.options();
  return {
    title,
    color: options.color,
    lineWidth: HISTOGRAM_LINE_WIDTH,
    lineType: 'histogram',
    lineStyle: 'solid',
    visible: options.visible,
    points: pointStatesOf(series.data()),
  };
}

/** Every point of a plot the library holds a value for, in bar order. */
function pointStatesOf(points: readonly IndicatorPlotPoint[]): IndicatorPointState[] {
  return points.filter(isValuePoint).map(pointStateOf);
}

function pointStateOf(point: LineData<Time> | HistogramData<Time>): IndicatorPointState {
  return { time: secondsOf(point.time), value: point.value, color: point.color ?? null };
}

/** The seconds of a point's time; the layer only ever writes `UTCTimestamp` values. */
function secondsOf(time: Time): number {
  return typeof time === 'number' ? time : Number.NaN;
}
