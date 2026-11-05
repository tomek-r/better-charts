import { useMemo } from 'react';
import { withIndicators } from '../chart/chartSettings/chartSettings';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import type { DrawingTimeframeVisibility } from '../chart/engine/drawings/timeframeVisibility';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import { withIndicatorHidden, withIndicatorSettings, withoutIndicator } from './savedIndicatorEdits';

/** What the object tree does to the saved indicators: each command saves, and the chart follows the list. */
export interface IndicatorCommands {
  readonly setHidden: (instanceId: string, hidden: boolean) => void;
  readonly setSettings: (
    instanceId: string,
    values: SettingValues,
    timeframeVisibility?: DrawingTimeframeVisibility,
  ) => void;
  readonly remove: (instanceId: string) => void;
}

/**
 * The commands of an indicator row: hide or show one saved indicator, replace its settings and the timeframes it
 * shows on, and detach it. Every one of them writes the edited list through the chart settings, which the chart's
 * sync follows.
 */
export function useIndicatorCommands(): IndicatorCommands {
  const { settings, keep } = useChartSettings();
  return useMemo(
    () => ({
      setHidden: (instanceId, hidden) => {
        keep(withIndicators(settings, withIndicatorHidden(settings.indicators, instanceId, hidden)));
      },
      setSettings: (instanceId, values, timeframeVisibility) => {
        const edited = withIndicatorSettings(settings.indicators, instanceId, values, timeframeVisibility);
        keep(withIndicators(settings, edited));
      },
      remove: (instanceId) => {
        keep(withIndicators(settings, withoutIndicator(settings.indicators, instanceId)));
      },
    }),
    [settings, keep],
  );
}
