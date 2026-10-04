/**
 * Tools exposed by the chart's compact drawing rail.
 *
 * `null` is the Cursor. `crosshair` is the Cross tool: a pointer-driven
 * crosshair (chart/crosshair.ts) that never places a drawing, so it stays armed
 * until another tool is picked or Escape is pressed. `fixedRangeProfile` is the
 * two-click range gesture that commits a fixed-range volume profile.
 */
export type DrawingTool = 'fixedRangeProfile' | 'crosshair' | null;
