import type { CustomBarItemData, CustomData, Time } from 'lightweight-charts';
import type { VisibleBarIndices } from './customBarRenderer';

/**
 * The visible bars the price scale can place, in the order they are drawn: `plot` turns each bar into what
 * the renderer paints, or null when the price scale cannot place it.
 */
export function plottedVisibleBars<Point extends CustomData<Time>, Plotted>(
  bars: readonly CustomBarItemData<Time, Point>[],
  visibleBars: VisibleBarIndices,
  plot: (point: Point, x: number) => Plotted | null,
): Plotted[] {
  const plotted: Plotted[] = [];
  for (let index = visibleBars.from; index < visibleBars.to; index += 1) {
    const bar = bars[index];
    if (bar === undefined) {
      continue;
    }
    const one = plot(bar.originalData, bar.x);
    if (one === null) {
      continue;
    }
    plotted.push(one);
  }
  return plotted;
}
