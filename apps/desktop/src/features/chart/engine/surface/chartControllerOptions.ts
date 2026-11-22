import type { ChartToolDefinition, ChartToolHost } from '../tools/toolContract';
import type { ChartIndicatorDefinition } from '../indicators/indicatorContract';
import type { IndicatorLegendWords } from '../legend/indicatorLegend';
import type { IndicatorSeriesSource } from '../indicators/indicatorSeriesSource';
import type { IndicatorTickSource } from '../indicators/indicatorTickSource';
import type { SettingValues } from '../settings/settingInputs';

/** What the app gives the chart for its tools; a tool sees it only through its `ChartToolHost`. */
export type ChartControllerOptions = Pick<ChartToolHost, 'currentMarket' | 'marketDataPort' | 'notifyError'> & {
  toolDefinitions: readonly ChartToolDefinition[];
  /** Every indicator a user can attach; the engine never imports the registry they come from. */
  indicatorDefinitions: readonly ChartIndicatorDefinition[];
  /** The legend's words for an attached indicator, e.g. "SMA" then "9 close"; the app owns them. */
  indicatorLegendWords: (definitionId: string, settings: SettingValues) => IndicatorLegendWords;
  /**
   * Another timeframe's candles for an indicator, read through the app; omitted on a chart the bridge cannot
   * serve, whose indicators then calculate from the bars they are given.
   */
  indicatorSeriesSource?: IndicatorSeriesSource;
  /**
   * The chart symbol's raw ticks for an indicator, read through the app; omitted on a chart the bridge cannot
   * serve, whose indicators then calculate from the bars they are given.
   */
  indicatorTickSource?: IndicatorTickSource;
  /** The tool active at start and made active again after a placement; one of `toolDefinitions`. */
  defaultToolId: string;
};
