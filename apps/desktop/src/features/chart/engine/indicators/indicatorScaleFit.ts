import type { AutoscaleInfoProvider, IChartApi, IPaneApi, PriceScaleMargins, Time } from 'lightweight-charts';
import { PRICE_SCALE_ID } from '../priceScale/priceScaleId';
import type { IndicatorPlot, IndicatorPlotStyle } from './indicatorFrame';
import { PLOT_STYLE_RULES } from './indicatorPlotStyles';
import { numericPointAt } from './indicatorSeriesValue';

/** The series a floor is read from: whatever `numericPointAt` reads one point out of. */
type PointSeries = Parameters<typeof numericPointAt>[0];

/** A plot holds a closed value only once a bar comes before its forming one. */
const CLOSED_VALUES_MINIMUM = 2;

/** No bottom margin: a plot drawn from zero stands on its pane's foot. */
const NO_BOTTOM_MARGIN = 0;

/**
 * The lowest of `values` other than the last one, which belongs to the forming bar; null while the plot
 * has no closed bar to fit. A volume's forming bar holds almost nothing, so its low value would flatten
 * the scale around it for as long as the bar is open.
 */
export function lowestClosedValue(values: readonly number[]): number | null {
  if (values.length < CLOSED_VALUES_MINIMUM) {
    return null;
  }
  return Math.min(...values.slice(0, -1));
}

/**
 * The autoscale provider a plot that only grows during its bar runs: it keeps the forming bar's low
 * value out of the scale's floor, so the bar's first ticks cannot squash the pane, and leaves the top
 * of the range and the scale's margins to the values themselves.
 */
export function closedBarsFloor(series: PointSeries, chart: IChartApi): AutoscaleInfoProvider {
  return (baseImplementation) => {
    const autoscale = baseImplementation();
    if (autoscale === null || autoscale.priceRange === null) {
      return autoscale;
    }
    const lowestClosed = lowestClosedValue(visibleValues(series, chart));
    if (lowestClosed === null) {
      return autoscale;
    }
    const { minValue, maxValue } = autoscale.priceRange;
    const floor = Math.min(lowestClosed, maxValue);
    if (floor <= minValue) {
      return autoscale;
    }
    return { ...autoscale, priceRange: { minValue: floor, maxValue } };
  };
}

/** Whether a plot style draws its values from price zero, as columns and stems do. */
export function drawsFromZero(style: IndicatorPlotStyle): boolean {
  return PLOT_STYLE_RULES[style].drawsFromZero;
}

/**
 * Gives an own pane's right scale the price margins its first plot needs: a plot standing on the pane's
 * foot takes the chart's top margin and no bottom margin, so its columns rise from the foot with no
 * negative range under them. Any other plot takes the chart's own margins back.
 */
export function applyPlotScaleMargins(
  chart: IChartApi,
  pane: IPaneApi<Time>,
  firstPlot: IndicatorPlot | undefined,
): void {
  const chartMargins = chartScaleMargins(chart);
  const priceScale = pane.priceScale(PRICE_SCALE_ID);
  if (standsOnPaneFoot(firstPlot)) {
    priceScale.applyOptions({ scaleMargins: { top: chartMargins.top, bottom: NO_BOTTOM_MARGIN } });
    return;
  }
  priceScale.applyOptions({ scaleMargins: chartMargins });
}

/** The values drawn on the visible bars of `series`, in bar order. */
function visibleValues(series: PointSeries, chart: IChartApi): number[] {
  const visibleRange = chart.timeScale().getVisibleLogicalRange();
  if (visibleRange === null) {
    return [];
  }
  const values: number[] = [];
  const lastVisibleIndex = Math.floor(visibleRange.to);
  for (let index = Math.max(Math.ceil(visibleRange.from), 0); index <= lastVisibleIndex; index += 1) {
    const point = numericPointAt(series, index);
    if (point !== null) {
      values.push(point.value);
    }
  }
  return values;
}

/** The price margins of the chart's own right scale, which every pane's scale starts from. */
function chartScaleMargins(chart: IChartApi): PriceScaleMargins {
  const { scaleMargins } = chart.options().rightPriceScale;
  return { top: scaleMargins.top, bottom: scaleMargins.bottom };
}

/** Whether a plot's values stand on its pane's foot: drawn from zero, for a value that grows during its bar. */
function standsOnPaneFoot(plot: IndicatorPlot | undefined): boolean {
  if (plot === undefined) {
    return false;
  }
  return plot.growsDuringBar === true && drawsFromZero(plot.style);
}
