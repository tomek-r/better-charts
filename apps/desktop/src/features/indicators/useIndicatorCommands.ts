import { useEffect, useMemo, useRef } from 'react';
import { withIndicators, type ChartSettings } from '../chart/chartSettings/chartSettings';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import type { SavedIndicator } from '../chart/chartSettings/savedIndicators';
import type { DrawingTimeframeVisibility } from '../chart/engine/drawings/timeframeVisibility';
import type { IndicatorPaneHeight } from '../chart/engine/indicators/indicatorLayer';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import {
  withIndicatorHidden,
  withIndicatorPaneHeights,
  withIndicatorSettings,
  withoutIndicator,
} from './savedIndicatorEdits';

/** What one command does to the saved indicators: the list it should hold after the edit. */
type IndicatorListEdit = (saved: readonly SavedIndicator[]) => readonly SavedIndicator[];

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
  // The settings of the latest render, which a command reads when it is called rather than when it was made.
  const latestSettings = useRef(settings);
  useEffect(() => {
    latestSettings.current = settings;
  }, [settings]);

  // The commands keep the identity of the chart's own saving commands, so a row that holds them is not
  // re-registered with the legend on every settings change.
  return useMemo<IndicatorCommands>(() => {
    const editedSettings = (edit: IndicatorListEdit): ChartSettings => {
      const current = latestSettings.current;
      return withIndicators(current, edit(current.indicators));
    };
    return {
      setHidden: (instanceId, hidden) =>
        keep(editedSettings((saved) => withIndicatorHidden(saved, instanceId, hidden))),
      setSettings: (instanceId, values, timeframeVisibility) =>
        keep(editedSettings((saved) => withIndicatorSettings(saved, instanceId, values, timeframeVisibility))),
      previewSettings: (instanceId, values) =>
        preview(editedSettings((saved) => withIndicatorSettings(saved, instanceId, values))),
      revertPreview: () => revert(),
      remove: (instanceId) => keep(editedSettings((saved) => withoutIndicator(saved, instanceId))),
      setPaneHeights: (heights) => keep(editedSettings((saved) => withIndicatorPaneHeights(saved, heights))),
    };
  }, [keep, preview, revert]);
}
