import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { IndicatorPlot } from './indicatorFrame';
import { priceFormatOf } from './indicatorPanes';
import { IndicatorPlotMarkers, type IndicatorMarkerShape } from './indicatorPlotMarkers';
import { PLOT_STYLE_RULES, type IndicatorPlotSeries, type PlotStyleRule } from './indicatorPlotStyles';
import { closedBarsFloor } from './indicatorScaleFit';

/** The library's own names for its column and area series, which `seriesType()` reports back. */
const HISTOGRAM_SERIES_TYPE = 'Histogram';
const AREA_SERIES_TYPE = 'Area';

/** Each plot's marker primitive, keyed by its series so the primitive goes away with the series. */
const markerPrimitives = new WeakMap<IndicatorPlotSeries, IndicatorPlotMarkers>();

/** Each plot's style rule, keyed by its series so the rule goes away with the series. */
const plotStyleRules = new WeakMap<IndicatorPlotSeries, PlotStyleRule>();

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
  const rule = PLOT_STYLE_RULES[plot.style];
  const series = rule.addSeries(chart, plot, paneIndex, priceLabelsVisible);
  applyPriceFormat(series, precision);
  applyClosedBarsFloor(series, plot, rule, chart);
  attachMarkers(series, rule.markerShape, plot.color);
  plotStyleRules.set(series, rule);
  return series;
}

/** Whether `series` draws columns from zero rather than a line. */
export function isHistogramPlotSeries(series: IndicatorPlotSeries): series is ISeriesApi<'Histogram'> {
  return series.seriesType() === HISTOGRAM_SERIES_TYPE;
}

/** Whether `series` shades the region under its line rather than drawing the line alone. */
function isAreaPlotSeries(series: IndicatorPlotSeries): series is ISeriesApi<'Area'> {
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
  if (plotStyleRuleOf(series).hidesWholeSeries) {
    series.applyOptions({ visible: !hidden && plotVisible });
    return;
  }
  series.applyOptions({ visible: !hidden });
}

/** A plot's colour: an area keeps it on its line, every other series reports it as `color`. */
export function plotColorOf(series: IndicatorPlotSeries): string {
  return isAreaPlotSeries(series) ? series.options().lineColor : series.options().color;
}

/** The style rule `series` was created with; every series comes from `addPlotSeries`. */
export function plotStyleRuleOf(series: IndicatorPlotSeries): PlotStyleRule {
  const rule = plotStyleRules.get(series);
  if (rule === undefined) {
    throw new Error('A plot series was not created by addPlotSeries.');
  }
  return rule;
}

/** Gives `series` the markers its style draws, recording them so removal can detach them. */
function attachMarkers(series: IndicatorPlotSeries, shape: IndicatorMarkerShape | null, color: string): void {
  if (shape === null) {
    return;
  }
  const markers = new IndicatorPlotMarkers(shape, color);
  series.attachPrimitive(markers);
  markerPrimitives.set(series, markers);
}

/**
 * Raises the plot's scale floor over the low value of its forming bar: a plot that only grows while its
 * bar forms would otherwise squash the pane on the bar's first ticks. A plot drawn from zero already
 * stands on the pane's foot, so its columns and stems keep their own anchor.
 */
function applyClosedBarsFloor(
  series: IndicatorPlotSeries,
  plot: IndicatorPlot,
  rule: PlotStyleRule,
  chart: IChartApi,
): void {
  if (plot.growsDuringBar !== true || rule.drawsFromZero) {
    return;
  }
  series.applyOptions({ autoscaleInfoProvider: closedBarsFloor(series, chart) });
}

/** `series` writing its values with `precision` decimals when the frame states them. */
function applyPriceFormat(series: IndicatorPlotSeries, precision: number | null): void {
  const priceFormat = priceFormatOf(precision);
  if (priceFormat !== undefined) {
    series.applyOptions({ priceFormat });
  }
}
