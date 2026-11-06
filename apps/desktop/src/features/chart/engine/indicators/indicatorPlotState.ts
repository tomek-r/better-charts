import type { HistogramData, ISeriesApi, LineData, Time } from 'lightweight-charts';
import type { IndicatorLineStyle } from './indicatorFrame';
import { toIndicatorLineStyle } from './indicatorLevels';
import { isValuePoint, pointColorOf, type IndicatorPlotPoint } from './indicatorPoints';
import { isHistogramPlotSeries, plotColorOf, plotStyleRuleOf } from './indicatorPlotSeries';
import type { IndicatorLineType, IndicatorPlotSeries } from './indicatorPlotStyles';

/** Columns have no stroke, so they report the thinnest width the legend can still paint a swatch in. */
const HISTOGRAM_LINE_WIDTH = 1;

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

/** One plot as the dev hook shows it, read back out of its series. */
export function plotStateOf(series: IndicatorPlotSeries, title: string): IndicatorPlotState {
  if (isHistogramPlotSeries(series)) {
    return histogramStateOf(series, title);
  }
  return strokeStateOf(series, title);
}

function histogramStateOf(series: ISeriesApi<'Histogram'>, title: string): IndicatorPlotState {
  const options = series.options();
  return {
    title,
    color: options.color,
    lineWidth: HISTOGRAM_LINE_WIDTH,
    lineType: plotStyleRuleOf(series).lineType,
    lineStyle: 'solid',
    visible: options.visible,
    priceLabelVisible: options.lastValueVisible,
    priceLineVisible: options.priceLineVisible,
    points: pointStatesOf(series.data()),
  };
}

function strokeStateOf(series: ISeriesApi<'Line'> | ISeriesApi<'Area'>, title: string): IndicatorPlotState {
  const options = series.options();
  const rule = plotStyleRuleOf(series);
  return {
    title,
    color: plotColorOf(series),
    lineWidth: options.lineWidth,
    lineType: rule.lineType,
    lineStyle: toIndicatorLineStyle(options.lineStyle),
    visible: rule.hidesWholeSeries ? options.visible : options.lineVisible,
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
