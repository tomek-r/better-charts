import type { PlotChartPoint, PlotInk } from './indicatorPlotHits';
import { MARKER_HALF_SIZE_CSS_PX } from './indicatorMarkerSize';

/** The line a plot strokes through its points, if it strokes one. */
export type PlotLine = 'none' | 'straight' | 'stepped';

/** What a plot puts at each of its points, beyond its line. */
export type PlotMark =
  { readonly kind: 'none' } | { readonly kind: 'marker' } | { readonly kind: 'column'; readonly baseY: number };

/** How a plot draws what it plots, as the hit test reads it. */
export interface PlotDrawing {
  readonly line: PlotLine;
  readonly mark: PlotMark;
}

/** A point of the plot with nothing to pick. */
const NO_INK: readonly PlotInk[] = [];

/**
 * The ink one run of a plot draws: the stroke between neighbouring points, and the mark every point
 * carries. A run starts and ends where the plot breaks — a bar without a point breaks the line too.
 */
export function runInk(points: readonly PlotChartPoint[], drawing: PlotDrawing): readonly PlotInk[] {
  const ink: PlotInk[] = [];
  let previous: PlotChartPoint | null = null;
  for (const point of points) {
    const mark = markInk(point, drawing.mark);
    if (mark !== null) {
      ink.push(mark);
    }
    if (previous !== null) {
      ink.push(...lineInk(previous, point, drawing.line));
    }
    previous = point;
  }
  return ink;
}

/**
 * The mark one point carries: a marker's disc, its arms reaching a half width out; the column drawn up
 * from the base; or nothing to pick.
 */
function markInk(point: PlotChartPoint, mark: PlotMark): PlotInk | null {
  if (mark.kind === 'marker') {
    return { from: point, to: point, halfWidth: MARKER_HALF_SIZE_CSS_PX };
  }
  if (mark.kind === 'column') {
    return { from: point, to: { x: point.x, y: mark.baseY }, halfWidth: 0 };
  }
  return null;
}

/** The stroke between two neighbouring points; a stepped line turns where the later point sits. */
function lineInk(from: PlotChartPoint, to: PlotChartPoint, line: PlotLine): readonly PlotInk[] {
  if (line === 'none') {
    return NO_INK;
  }
  if (line === 'straight') {
    return [{ from, to, halfWidth: 0 }];
  }
  const turn = { x: to.x, y: from.y };
  return [
    { from, to: turn, halfWidth: 0 },
    { from: turn, to, halfWidth: 0 },
  ];
}
