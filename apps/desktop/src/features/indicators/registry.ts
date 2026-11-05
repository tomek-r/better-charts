import { bollingerPlugin } from './bollinger/bollingerPlugin';
import type { ChartIndicatorPlugin } from './chartIndicatorPlugin';
import { macdPlugin } from './macd/macdPlugin';
import { rsiPlugin } from './rsi/rsiPlugin';
import { smaPlugin } from './sma/smaPlugin';

/**
 * Every chart indicator the app can add. Adding an indicator is a folder under
 * `features/indicators/` and one entry here; the engine never imports this list.
 */
export const CHART_INDICATOR_PLUGINS = [
  smaPlugin,
  bollingerPlugin,
  rsiPlugin,
  macdPlugin,
] as const satisfies readonly ChartIndicatorPlugin[];

export type ChartIndicatorId = (typeof CHART_INDICATOR_PLUGINS)[number]['id'];

export type RegisteredChartIndicatorPlugin = ChartIndicatorPlugin<ChartIndicatorId>;

export function findChartIndicatorPlugin(id: string): RegisteredChartIndicatorPlugin | undefined {
  return CHART_INDICATOR_PLUGINS.find((plugin) => plugin.id === id);
}
