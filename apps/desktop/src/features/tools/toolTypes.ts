/**
 * Tools exposed by the chart's compact drawing rail.
 *
 * `null` is the Cursor. `crosshair` is the Cross tool: a pointer-driven
 * crosshair (chart/crosshair.ts) that never places a drawing, so it stays armed
 * until another tool is picked or Escape is pressed. Every other tool places a
 * drawing on the chart and implements the engine's `ChartTool` contract
 * (chart/engine/chartTool.ts).
 */
export type ChartToolId = 'fixedRangeProfile';

export type DrawingTool = ChartToolId | 'crosshair' | null;

/**
 * The drawing tools as the rail lists them, in rail order. A new tool adds its
 * row here, its icon to DrawingToolIcon and its `ChartTool` to the controller.
 */
export const CHART_TOOLS: ReadonlyArray<{ id: ChartToolId; label: string }> = [
  { id: 'fixedRangeProfile', label: 'Fixed range volume profile' },
];
