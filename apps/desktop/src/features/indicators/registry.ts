import { bollingerPlugin } from './bollinger/bollingerPlugin';
import { withCalculation } from './calculation/withCalculation';
import type { ChartIndicatorPlugin } from './chartIndicatorPlugin';
import { emaPlugin } from './ema/emaPlugin';
import { macdPlugin } from './macd/macdPlugin';
import { rsiPlugin } from './rsi/rsiPlugin';
import { smaPlugin } from './sma/smaPlugin';
import { volumePlugin } from './volume/volumePlugin';

/**
 * Every chart indicator the app can add: each plugin with the Calculation section's timeframe and wait
 * switch, calculated through the one higher-timeframe wrapper. Adding an indicator is a folder under
 * `features/indicators/` and one entry here; the engine never imports this list. The list is kept
 * alphabetical by title, which is the order the dialog shows.
 */
export const CHART_INDICATOR_PLUGINS = [
  withCalculation(bollingerPlugin),
  withCalculation(macdPlugin),
  withCalculation(emaPlugin),
  withCalculation(smaPlugin),
  withCalculation(rsiPlugin),
  withCalculation(volumePlugin),
] as const satisfies readonly ChartIndicatorPlugin[];

export type ChartIndicatorId = (typeof CHART_INDICATOR_PLUGINS)[number]['id'];

export type RegisteredChartIndicatorPlugin = ChartIndicatorPlugin<ChartIndicatorId>;

export function findChartIndicatorPlugin(id: string): RegisteredChartIndicatorPlugin | undefined {
  return CHART_INDICATOR_PLUGINS.find((plugin) => plugin.id === id);
}
