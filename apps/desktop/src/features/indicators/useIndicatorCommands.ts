import { useMemo } from 'react';
import { withIndicators } from '../chart/chartSettings/chartSettings';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import type { DrawingTimeframeVisibility } from '../chart/engine/drawings/timeframeVisibility';
import type { IndicatorPaneHeight } from '../chart/engine/indicators/indicatorLayer';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import {
  withIndicatorHidden,
  withIndicatorPaneHeights,
  withIndicatorSettings,
  withoutIndicator,
} from './savedIndicatorEdits';

/**
 * What the object tree does to the saved indicators: each command saves, except the previews, which only show,
 * and the chart follows the list.
 */
export interface IndicatorCommands {
  readonly setHidden: (instanceId: string, hidden: boolean) => void;
  readonly setSettings: (
    instanceId: string,
    values: SettingValues,
    timeframeVisibility?: DrawingTimeframeVisibility,
  ) => void;
  /** Shows the edited settings on the chart without saving them; OK saves them, a revert shows the saved ones. */
  readonly previewSettings: (instanceId: string, values: SettingValues) => void;
  readonly revertPreview: () => void;
  readonly remove: (instanceId: string) => void;
  /** Saves the heights the user dragged the pane separators to, relative to the price pane. */
  readonly setPaneHeights: (heights: readonly IndicatorPaneHeight[]) => void;
}

/**
 * The commands of an indicator row: hide or show one saved indicator, replace its settings and the timeframes it
 * shows on, detach it, show a draft without saving it, and save the heights of the panes the user resized. Every
 * saving one writes the edited list through the chart settings, which the chart's sync follows.
 */
export function useIndicatorCommands(): IndicatorCommands {
  const { settings, keep, preview, revert } = useChartSettings();
  return useMemo(
    () => ({
      setHidden: (instanceId, hidden) => {
        keep(withIndicators(settings, withIndicatorHidden(settings.indicators, instanceId, hidden)));
      },
      setSettings: (instanceId, values, timeframeVisibility) => {
        const edited = withIndicatorSettings(settings.indicators, instanceId, values, timeframeVisibility);
        keep(withIndicators(settings, edited));
      },
      previewSettings: (instanceId, values) => {
        preview(withIndicators(settings, withIndicatorSettings(settings.indicators, instanceId, values)));
      },
      revertPreview: () => {
        revert();
      },
      remove: (instanceId) => {
        keep(withIndicators(settings, withoutIndicator(settings.indicators, instanceId)));
      },
      setPaneHeights: (heights) => {
        keep(withIndicators(settings, withIndicatorPaneHeights(settings.indicators, heights)));
      },
    }),
    [settings, keep, preview, revert],
  );
}
