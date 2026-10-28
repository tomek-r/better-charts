import type { ChartToolPlugin } from './chartToolPlugin';
import { arrowPlugin } from './arrow/arrowPlugin';
import { crosshairPlugin } from './crosshair/crosshairPlugin';
import { fixedRangeProfilePlugin } from './fixedRangeProfile/fixedRangeProfilePlugin';

/**
 * Every chart tool, pointers included, in rail order. Adding a tool is a folder
 * under `features/tools/` and one entry here; the controller, rail, icon and
 * lifecycle iterate this list.
 */
export const CHART_TOOL_PLUGINS = [
  arrowPlugin,
  crosshairPlugin,
  fixedRangeProfilePlugin,
] as const satisfies readonly ChartToolPlugin[];

export type ChartToolId = (typeof CHART_TOOL_PLUGINS)[number]['id'];

/** Active when nothing else is: at startup, after Escape and after a placement tool finishes. */
export const DEFAULT_CHART_TOOL_ID: ChartToolId = 'arrow';
