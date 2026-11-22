import type { RenderBar } from '../../chart/engine/bars/renderBar';
import { NO_FRAME_BAR } from '../indicatorFrameBars';
import type { TickBarSeries } from './tickBars';

/** Which tick bar a chart bar takes its values from. */
export type TickBarSource =
  /** The last tick bar whose final tick arrived inside the chart bar, the forming one included. */
  | 'last-in-chart-bar'
  /** The last tick bar inside it that has all its ticks, so the forming one is left out. */
  | 'last-closed-in-chart-bar';

const MILLISECONDS_PER_SECOND = 1000;

/** How many of `series`' bars a chart bar may show: the closed ones, or the closed and the forming one. */
function shownCount(series: TickBarSeries, source: TickBarSource): number {
  return source === 'last-closed-in-chart-bar' ? series.closedCount : series.bars.length;
}

/**
 * For every chart bar, the index of the tick bar it shows: the last one whose final tick arrived inside it, or,
 * when `source` asks for closes, the last one that has all its ticks. `NO_FRAME_BAR` while no such bar ends
 * inside it, which is every chart bar older than the ticks the read holds.
 */
export function shownTickBars(
  series: TickBarSeries,
  chartBars: readonly RenderBar[],
  chartSeconds: number,
  source: TickBarSource,
): readonly number[] {
  const lastShown = shownCount(series, source) - 1;
  const chartSpanMs = chartSeconds * MILLISECONDS_PER_SECOND;
  const shownOf: number[] = [];
  let next = 0;
  for (const chartBar of chartBars) {
    const chartStartMs = chartBar.time * MILLISECONDS_PER_SECOND;
    while (next <= lastShown && series.endsMs[next] < chartStartMs) {
      next += 1;
    }
    let shown = NO_FRAME_BAR;
    while (next <= lastShown && series.endsMs[next] < chartStartMs + chartSpanMs) {
      shown = next;
      next += 1;
    }
    shownOf.push(shown);
  }
  return shownOf;
}
