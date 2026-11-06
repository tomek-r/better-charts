import {
  AreaSeries,
  HistogramSeries,
  LineSeries,
  LineType,
  type AutoscaleInfoProvider,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesType,
  type Time,
  type WhitespaceData,
} from 'lightweight-charts';
import { withOpacityPercent } from '../../../../shared/theme/hexColor';
import type { IndicatorLineStyle, IndicatorPlot, IndicatorPlotStyle } from './indicatorFrame';
import { toIndicatorLineStyle, toLibraryLineStyle } from './indicatorLevels';
import { toLineWidth } from './indicatorLineWidth';
import { priceFormatOf } from './indicatorPanes';
import { IndicatorPlotMarkers, type IndicatorMarkerShape } from './indicatorPlotMarkers';
import { closedBarsFloor, drawsFromZero } from './indicatorScaleFit';

/** The library's own names for its column and area series, which `seriesType()` reports back. */
const HISTOGRAM_SERIES_TYPE = 'Histogram';
const AREA_SERIES_TYPE = 'Area';

/** Columns grow out of zero and stems reach down to it, so both plots are anchored at price zero. */
const ZERO_PRICE = 0;

/** Columns have no stroke, so they report the thinnest width the legend can still paint a swatch in. */
const HISTOGRAM_LINE_WIDTH = 1;

/** An area plot's shaded top is its colour at 40% opacity; its bottom is fully transparent. */
export const AREA_TOP_OPACITY_PERCENT = 40;
export const AREA_BOTTOM_OPACITY_PERCENT = 0;

/** The marker each style draws, when it draws one. */
const MARKER_SHAPES: Record<IndicatorPlotStyle, IndicatorMarkerShape | null> = {
  line: null,
  stepline: null,
  steplineDiamonds: 'diamond',
  area: null,
  histogram: null,
  stems: 'stem',
  crosses: 'cross',
  circles: 'circle',
};

/** The drawn line type of a plot whose line carries one shape's markers. */
const MARKER_LINE_TYPES: Record<IndicatorMarkerShape, IndicatorLineType> = {
  stem: 'stems',
  cross: 'crosses',
  circle: 'circles',
  diamond: 'stepDiamonds',
};

/** Each plot's marker primitive, keyed by its series so the primitive goes away with the series. */
const markerPrimitives = new WeakMap<IndicatorPlotSeries, IndicatorPlotMarkers>();

/** One plot's series: a line, a shaded area, or columns drawn from zero. */
export type IndicatorPlotSeries = ISeriesApi<'Line'> | ISeriesApi<'Area'> | ISeriesApi<'Histogram'>;

/** How a drawn plot is drawn, as the dev hook reports it. */
export type IndicatorLineType =
  'simple' | 'step' | 'stepDiamonds' | 'area' | 'histogram' | 'stems' | 'crosses' | 'circles';

/** An area point: its value and the colours its bar shades the band with. */
export type IndicatorAreaPoint = LineData<Time> & {
  readonly lineColor?: string;
  readonly topColor?: string;
  readonly bottomColor?: string;
};
/** A point as the library holds it: a value to draw, or the time-only gap that breaks the plot. */
export type IndicatorPlotPoint = LineData<Time> | IndicatorAreaPoint | WhitespaceData<Time> | HistogramData<Time>;

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
  /** Whether the plot's last value is written on the price scale. */
  readonly priceLabelVisible: boolean;
  /** Whether the plot's last value draws the horizontal price line. */
  readonly priceLineVisible: boolean;
  readonly points: readonly IndicatorPointState[];
}

/**
 * Adds one plot's series at `paneIndex`, writing its values with `precision` decimals when the frame
 * states them. `priceLabelsVisible` writes each visible plot's last value on the price scale.
 */
export function addPlotSeries(
  chart: IChartApi,
  plot: IndicatorPlot,
  paneIndex: number | undefined,
  precision: number | null,
  priceLabelsVisible: boolean,
): IndicatorPlotSeries {
  if (plot.style === 'area') {
    const areaSeries = chart.addSeries(AreaSeries, areaOptionsOf(plot, priceLabelsVisible), paneIndex);
    return withClosedBarsFloor(withPriceFormat(areaSeries, precision), plot, chart);
  }
  if (plot.style === 'histogram') {
    const histogramSeries = chart.addSeries(HistogramSeries, histogramOptionsOf(plot, priceLabelsVisible), paneIndex);
    return withClosedBarsFloor(withPriceFormat(histogramSeries, precision), plot, chart);
  }
  const lineSeries = chart.addSeries(LineSeries, lineSeriesOptionsOf(plot, priceLabelsVisible), paneIndex);
  return withMarkers(withClosedBarsFloor(withPriceFormat(lineSeries, precision), plot, chart), plot);
}

/** Whether `series` draws columns from zero rather than a line. */
export function isHistogramPlotSeries(series: IndicatorPlotSeries): series is ISeriesApi<'Histogram'> {
  return series.seriesType() === HISTOGRAM_SERIES_TYPE;
}

/** Whether `series` shades the region under its line rather than drawing the line alone. */
export function isAreaPlotSeries(series: IndicatorPlotSeries): series is ISeriesApi<'Area'> {
  return series.seriesType() === AREA_SERIES_TYPE;
}

/** Takes one plot off the chart, detaching its markers first so no repaint reads a removed series. */
export function removePlotSeries(chart: IChartApi, series: IndicatorPlotSeries): void {
  const markers = markerPrimitives.get(series);
  if (markers !== undefined) {
    series.detachPrimitive(markers);
    markerPrimitives.delete(series);
  }
  chart.removeSeries(series);
}

/**
 * Shows or hides one plot's series. A plot drawn without a line hides its whole series, while a line
 * keeps its series and hides only the line, so the levels and the fill it carries stay on the chart.
 */
export function setPlotSeriesHidden(series: IndicatorPlotSeries, hidden: boolean, plotVisible: boolean): void {
  if (hidesWholeSeries(series)) {
    series.applyOptions({ visible: !hidden && plotVisible });
    return;
  }
  series.applyOptions({ visible: !hidden });
}

/** Whether `point` draws a value rather than marking the gap that breaks the plot. */
export function isValuePoint(point: IndicatorPlotPoint): point is LineData<Time> | HistogramData<Time> {
  return 'value' in point;
}

/** The colour a drawn point carries: an area keeps it on `lineColor`, every other point on `color`. */
export function pointColorOf(point: IndicatorPlotPoint): string | null {
  if ('lineColor' in point) {
    return point.lineColor ?? null;
  }
  if (!('color' in point)) {
    return null;
  }
  return point.color ?? null;
}

/** One plot as the dev hook shows it, read back out of its series. */
export function plotStateOf(series: IndicatorPlotSeries, title: string): IndicatorPlotState {
  if (isHistogramPlotSeries(series)) {
    return histogramStateOf(series, title);
  }
  if (isAreaPlotSeries(series)) {
    return areaStateOf(series, title);
  }
  return lineStateOf(series, title);
}

/** A plot's colour: an area keeps it on its line, every other series reports it as `color`. */
export function plotColorOf(series: IndicatorPlotSeries): string {
  return isAreaPlotSeries(series) ? series.options().lineColor : series.options().color;
}

/** Whether a switched-off plot has no line to hide instead, so its whole series goes with it. */
function hidesWholeSeries(series: IndicatorPlotSeries): boolean {
  if (isHistogramPlotSeries(series)) {
    return true;
  }
  const markers = markerPrimitives.get(series);
  return markers !== undefined && markers.shape !== 'diamond';
}

/** How `series` is drawn, including the markers its line carries. */
function lineTypeOf(series: IndicatorPlotSeries): IndicatorLineType {
  if (isHistogramPlotSeries(series)) {
    return 'histogram';
  }
  if (isAreaPlotSeries(series)) {
    return 'area';
  }
  const markers = markerPrimitives.get(series);
  if (markers !== undefined) {
    return MARKER_LINE_TYPES[markers.shape];
  }
  return series.options().lineType === LineType.WithSteps ? 'step' : 'simple';
}

/** Whether a style draws markers with no line under them. */
function drawsMarkersOnly(style: IndicatorPlotStyle): boolean {
  return style === 'stems' || style === 'crosses' || style === 'circles';
}

/** Gives `series` the markers its style draws, recording them so removal can detach them. */
function withMarkers(series: ISeriesApi<'Line'>, plot: IndicatorPlot): IndicatorPlotSeries {
  const shape = MARKER_SHAPES[plot.style];
  if (shape === null) {
    return series;
  }
  const markers = new IndicatorPlotMarkers(shape, plot.color);
  series.attachPrimitive(markers);
  markerPrimitives.set(series, markers);
  return series;
}

/**
 * Raises the plot's scale floor over the low value of its forming bar: a plot that only grows while its
 * bar forms would otherwise squash the pane on the bar's first ticks. A plot drawn from zero already
 * stands on the pane's foot, so its columns and stems keep their own anchor.
 */
function withClosedBarsFloor<TSeries extends IndicatorPlotSeries>(
  series: TSeries,
  plot: IndicatorPlot,
  chart: IChartApi,
): TSeries {
  if (plot.growsDuringBar !== true || drawsFromZero(plot.style)) {
    return series;
  }
  series.applyOptions({ autoscaleInfoProvider: closedBarsFloor(series, chart) });
  return series;
}

/** Whether a plot writes its last value on the price scale: a switched-off plot writes none. */
function writesPriceLabel(plot: IndicatorPlot, priceLabelsVisible: boolean): boolean {
  return priceLabelsVisible && plot.visible !== false;
}

/** The options that keep price zero on the scale of a plot drawn from it: stems reach down to zero. */
function zeroAnchorOptionsOf(plot: IndicatorPlot) {
  return plot.style === 'stems' ? { autoscaleInfoProvider: includingZeroPrice } : {};
}

/** The stroke settings every plotted line shares, area or plain. */
function strokeOptionsOf(plot: IndicatorPlot, priceLabelsVisible: boolean) {
  return {
    lineWidth: toLineWidth(plot.lineWidth),
    lineStyle: toLibraryLineStyle(plot.lineStyle),
    lineVisible: plot.visible !== false,
    priceLineVisible: plot.priceLine === true,
    lastValueVisible: writesPriceLabel(plot, priceLabelsVisible),
    crosshairMarkerVisible: false,
  };
}

/** The options a line plot's series is created with. */
function lineOptionsOf(plot: IndicatorPlot, priceLabelsVisible: boolean) {
  return {
    color: plot.color,
    lineType: plotLineType(plot),
    ...strokeOptionsOf(plot, priceLabelsVisible),
    ...zeroAnchorOptionsOf(plot),
  };
}

/** The options a marker-only style's line plot is created with: its markers are all it shows. */
function lineSeriesOptionsOf(plot: IndicatorPlot, priceLabelsVisible: boolean) {
  const lineOptions = lineOptionsOf(plot, priceLabelsVisible);
  if (!drawsMarkersOnly(plot.style)) {
    return lineOptions;
  }
  return { ...lineOptions, lineVisible: false, visible: plot.visible !== false };
}

/** The options an area plot's series is created with: its colour shades the region under the line. */
function areaOptionsOf(plot: IndicatorPlot, priceLabelsVisible: boolean) {
  return {
    lineColor: plot.color,
    topColor: withOpacityPercent(plot.color, AREA_TOP_OPACITY_PERCENT),
    bottomColor: withOpacityPercent(plot.color, AREA_BOTTOM_OPACITY_PERCENT),
    ...strokeOptionsOf(plot, priceLabelsVisible),
    ...zeroAnchorOptionsOf(plot),
  };
}

/** The options a histogram plot's series is created with: one colour for every column unless a bar carries one. */
function histogramOptionsOf(plot: IndicatorPlot, priceLabelsVisible: boolean) {
  return {
    color: plot.color,
    base: ZERO_PRICE,
    priceLineVisible: plot.priceLine === true,
    lastValueVisible: writesPriceLabel(plot, priceLabelsVisible),
    visible: plot.visible !== false,
  };
}

/** The library's line type for a plot's style: both step styles draw across each bar. */
function plotLineType(plot: IndicatorPlot): LineType {
  return plot.style === 'stepline' || plot.style === 'steplineDiamonds' ? LineType.WithSteps : LineType.Simple;
}

/** Keeps price zero on the scale even when every value sits above it. */
const includingZeroPrice: AutoscaleInfoProvider = (baseImplementation) => {
  const autoscale = baseImplementation();
  if (autoscale === null || autoscale.priceRange === null) {
    return autoscale;
  }
  return {
    ...autoscale,
    priceRange: {
      minValue: Math.min(autoscale.priceRange.minValue, ZERO_PRICE),
      maxValue: Math.max(autoscale.priceRange.maxValue, ZERO_PRICE),
    },
  };
};

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
  const visible = hidesWholeSeries(series) ? options.visible : options.lineVisible;
  return strokeStateOf(series, title, lineTypeOf(series), visible);
}

function areaStateOf(series: ISeriesApi<'Area'>, title: string): IndicatorPlotState {
  return strokeStateOf(series, title, 'area', series.options().lineVisible);
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
    priceLabelVisible: options.lastValueVisible,
    priceLineVisible: options.priceLineVisible,
    points: pointStatesOf(series.data()),
  };
}

function strokeStateOf(
  series: ISeriesApi<'Line'> | ISeriesApi<'Area'>,
  title: string,
  lineType: IndicatorLineType,
  visible: boolean,
): IndicatorPlotState {
  const options = series.options();
  return {
    title,
    color: plotColorOf(series),
    lineWidth: options.lineWidth,
    lineType,
    lineStyle: toIndicatorLineStyle(options.lineStyle),
    visible,
    priceLabelVisible: options.lastValueVisible,
    priceLineVisible: options.priceLineVisible,
    points: pointStatesOf(series.data()),
  };
}

/** Every point of a plot the library holds a value for, in bar order. */
function pointStatesOf(points: readonly IndicatorPlotPoint[]): IndicatorPointState[] {
  return points.filter(isValuePoint).map(pointStateOf);
}

function pointStateOf(point: LineData<Time> | HistogramData<Time>): IndicatorPointState {
  return { time: secondsOf(point.time), value: point.value, color: pointColorOf(point) };
}

/** The seconds of a point's time; the layer only ever writes `UTCTimestamp` values. */
function secondsOf(time: Time): number {
  return typeof time === 'number' ? time : Number.NaN;
}
