import type { IChartApi } from 'lightweight-charts';
import type { PanePoint } from './indicatorPanePoint';
import { hitsInk } from './indicatorPlotHits';
import type { IndicatorPlotSeries } from './indicatorPlotStyles';
import { visibleInkOf } from './indicatorVisibleInk';

/** What the pick reads of one shown indicator: the series its plots draw, and what its frame hides. */
export interface PickableIndicator {
  readonly series: readonly IndicatorPlotSeries[];
  readonly plotVisible: readonly boolean[];
  readonly hidden: boolean;
}

/** The pane a shown indicator draws in, read from its first plot; null while it draws no series. */
export function drawnPaneOf(series: readonly IndicatorPlotSeries[]): number | null {
  return series[0]?.getPane().paneIndex() ?? null;
}

/**
 * The shown indicators from the top of their pane down, as the library orders their series: the greatest
 * series order is the one a click picks first.
 */
function topmostFirst(
  shownById: Iterable<readonly [string, PickableIndicator]>,
): (readonly [string, PickableIndicator])[] {
  const seriesOrderOf = (shown: PickableIndicator): number => shown.series[0]?.seriesOrder() ?? 0;
  return [...shownById].sort(([, left], [, right]) => seriesOrderOf(right) - seriesOrderOf(left));
}

/** Whether the point lands on the ink one of the indicator's drawn plots paints. */
function hitsPlot(chart: IChartApi, shown: PickableIndicator, point: PanePoint): boolean {
  const drawnPlots = shown.series.filter((_series, plotIndex) => shown.plotVisible[plotIndex]);
  return drawnPlots.some((series) => hitsInk(point, visibleInkOf(chart, series)));
}

/**
 * The indicator whose plot `point` lands on, topmost first; null when it lands on none. A plot picks by the
 * ink it draws — its line, its markers or its columns — within the hit tolerance, and an indicator drawing in
 * another pane or hidden from the chart picks nothing.
 */
export function pickIndicatorAt(
  chart: IChartApi,
  shownById: Iterable<readonly [string, PickableIndicator]>,
  point: PanePoint,
): string | null {
  for (const [id, shown] of topmostFirst(shownById)) {
    if (shown.hidden || drawnPaneOf(shown.series) !== point.paneIndex) {
      continue;
    }
    if (hitsPlot(chart, shown, point)) {
      return id;
    }
  }
  return null;
}
