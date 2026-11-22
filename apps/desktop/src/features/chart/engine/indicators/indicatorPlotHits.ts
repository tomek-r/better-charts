/** How far a click may land from a plot's ink and still pick its indicator, in CSS pixels. */
export const HIT_TOLERANCE_CSS_PX = 4;

/** A point in a pane's CSS pixels. */
export interface PlotChartPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * A run of a plot's ink the pointer can pick: from `from` to `to`, `halfWidth` CSS pixels thick either
 * side. A marker is the run that starts and ends on its centre, so its half width is its own radius.
 */
export interface PlotInk {
  readonly from: PlotChartPoint;
  readonly to: PlotChartPoint;
  readonly halfWidth: number;
}

/** The distance between two points. */
function gapBetween(first: PlotChartPoint, second: PlotChartPoint): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

/** The distance from `point` to the segment `from`–`to`, zero where the point lies on it. */
export function segmentGap(point: PlotChartPoint, from: PlotChartPoint, to: PlotChartPoint): number {
  const spanX = to.x - from.x;
  const spanY = to.y - from.y;
  const spanSquared = spanX * spanX + spanY * spanY;
  if (spanSquared === 0) {
    return gapBetween(point, from);
  }
  const along = ((point.x - from.x) * spanX + (point.y - from.y) * spanY) / spanSquared;
  const nearest = Math.min(1, Math.max(0, along));
  return gapBetween(point, { x: from.x + nearest * spanX, y: from.y + nearest * spanY });
}

/** The distance from `point` to the ink's nearest edge: its distance to the run, less the run's half width. */
export function inkGap(point: PlotChartPoint, ink: PlotInk): number {
  return segmentGap(point, ink.from, ink.to) - ink.halfWidth;
}

/** Whether `point` lands on one of the plot's ink runs, within the hit tolerance. */
export function hitsInk(point: PlotChartPoint, ink: readonly PlotInk[]): boolean {
  return ink.some((stroke) => inkGap(point, stroke) <= HIT_TOLERANCE_CSS_PX);
}
