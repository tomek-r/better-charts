import type { ChartDrawingPoint } from '../../../chart/engine/drawings/drawingRecord';
import type { ChartDrawingPointRule } from '../../../chart/engine/drawings/toolDrawings';
import type { FixedRangeProfileRange } from '../range';

/**
 * The points one fixed range volume profile drawing stores: the two edges of the profile window as time anchors. The
 * engine carries them as a plain anchor list, so this module is the one place that decides
 * whether a stored list is a window the tool can paint again.
 */

/** Every fixed range volume profile drawing anchors twice, and in time only: the two edges of its window. */
export const FIXED_RANGE_PROFILE_POINTS: ChartDrawingPointRule = { min: 2, max: 2, anchor: 'time' };

/** The two anchors of a window: its start, and the exclusive end of its last slot. */
export function fixedRangeProfilePoints(range: FixedRangeProfileRange): ChartDrawingPoint[] {
  return [
    { timeMs: range.fromMs, price: null },
    { timeMs: range.endMs, price: null },
  ];
}

/**
 * The window a stored list names, or undefined when it is not one: exactly two time-only anchors
 * that delimit a non-empty window. The reader of the record has already checked the milliseconds.
 */
export function readFixedRangeProfilePoints(points: readonly ChartDrawingPoint[]): FixedRangeProfileRange | undefined {
  if (points.length !== 2) {
    return undefined;
  }
  const [start, end] = points;
  if (start.price !== null || end.price !== null) {
    return undefined;
  }
  const fromMs = start.timeMs;
  const endMs = end.timeMs;
  if (fromMs === null || endMs === null || fromMs >= endMs) {
    return undefined;
  }
  return { fromMs, endMs };
}
