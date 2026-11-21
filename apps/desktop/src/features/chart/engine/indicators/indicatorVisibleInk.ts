import type { IChartApi, Logical, LogicalRange } from 'lightweight-charts';
import type { PlotChartPoint, PlotInk } from './indicatorPlotHits';
import { runInk, type PlotDrawing } from './indicatorPlotInk';
import { plotStyleRuleOf } from './indicatorPlotSeries';
import { PLOT_BASE_PRICE, plotDrawingOf, type IndicatorPlotSeries } from './indicatorPlotStyles';
import { numericPointAt } from './indicatorSeriesValue';

/** One bar either side of the visible range, so a run leaving the pane can still be clicked near its edge. */
const HIT_RANGE_MARGIN_BARS = 1;

/** The first bar a hit test reads. */
function firstHitBar(range: LogicalRange): number {
  return Math.floor(range.from) - HIT_RANGE_MARGIN_BARS;
}

/** The last bar a hit test reads. */
function lastHitBar(range: LogicalRange): number {
  return Math.ceil(range.to) + HIT_RANGE_MARGIN_BARS;
}

/** How a plot's series draws what it plots, and where its pane puts the price its columns grow from. */
function drawingOf(series: IndicatorPlotSeries): PlotDrawing {
  const rule = plotStyleRuleOf(series);
  return plotDrawingOf(rule, rule.drawsFromZero ? series.priceToCoordinate(PLOT_BASE_PRICE) : null);
}

/** The point `series` draws at bar `index`, in its pane's CSS pixels; null where it draws none. */
function plotPointAt(chart: IChartApi, series: IndicatorPlotSeries, index: number): PlotChartPoint | null {
  const x = chart.timeScale().logicalToCoordinate(index as Logical);
  const point = numericPointAt(series, index);
  const y = point === null ? null : series.priceToCoordinate(point.value);
  return x === null || y === null ? null : { x, y };
}

/**
 * The ink `series` draws inside `chart`'s visible range, in its pane's CSS pixels: its points run together
 * while they sit on neighbouring bars, and a bar without a point breaks the run as it breaks the line.
 */
export function visibleInkOf(chart: IChartApi, series: IndicatorPlotSeries): readonly PlotInk[] {
  const range = chart.timeScale().getVisibleLogicalRange();
  if (range === null) {
    return [];
  }
  const drawing = drawingOf(series);
  const ink: PlotInk[] = [];
  const last = lastHitBar(range);
  let run: PlotChartPoint[] = [];
  for (let index = firstHitBar(range); index <= last; index += 1) {
    const point = plotPointAt(chart, series, index);
    if (point === null) {
      ink.push(...runInk(run, drawing));
      run = [];
      continue;
    }
    run.push(point);
  }
  ink.push(...runInk(run, drawing));
  return ink;
}
