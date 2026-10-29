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

/** A registered plugin, with its id narrowed to the known tool ids. */
export type RegisteredChartToolPlugin = ChartToolPlugin<ChartToolId>;

/** The registered plugin with this id; undefined for a tool the app no longer knows. */
export function findChartToolPlugin(id: string): RegisteredChartToolPlugin | undefined {
  return CHART_TOOL_PLUGINS.find((plugin) => plugin.id === id);
}

/** Active when nothing else is: at startup, after Escape and after a placement tool finishes. */
export const DEFAULT_CHART_TOOL_ID: ChartToolId = 'arrow';
