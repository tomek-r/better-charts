import type { ChartToolDefinition, ChartToolHost } from '../tools/toolContract';
import type { ChartIndicatorDefinition } from '../indicators/indicatorContract';
import type { SettingValues } from '../settings/settingInputs';

/** What the app gives the chart for its tools; a tool sees it only through its `ChartToolHost`. */
export type ChartControllerOptions = Pick<ChartToolHost, 'currentMarket' | 'marketDataPort' | 'notifyError'> & {
  toolDefinitions: readonly ChartToolDefinition[];
  /** Every indicator a user can attach; the engine never imports the registry they come from. */
  indicatorDefinitions: readonly ChartIndicatorDefinition[];
  /** The legend's words for an attached indicator before its values, e.g. "SMA 9 close"; the app owns them. */
  indicatorLegendTitle: (definitionId: string, settings: SettingValues) => string;
  /** The tool active at start and made active again after a placement; one of `toolDefinitions`. */
  defaultToolId: string;
};
