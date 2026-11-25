import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { withIndicators, withStatusLineValue, type ChartSettings } from '../chart/chartSettings/chartSettings';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import type { SavedIndicator } from '../chart/chartSettings/savedIndicators';
import type { DrawingTimeframeVisibility } from '../chart/engine/drawings/timeframeVisibility';
import type { IndicatorPaneHeight } from '../chart/engine/indicators/indicatorLayer';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import {
  withIndicatorHidden,
  withIndicatorMoved,
  withIndicatorPaneHeights,
  withIndicatorSettings,
  withPricePaneOrder,
  withoutIndicator,
} from './savedIndicatorEdits';

/** What one command does to the saved indicators: the list it should hold after the edit. */
type IndicatorListEdit = (saved: readonly SavedIndicator[]) => readonly SavedIndicator[];

/** The settings of the latest render, which a command reads when it is called rather than when it was made. */
function useLatestSettings(): RefObject<ChartSettings> {
  const { settings } = useChartSettings();
  const latestSettings = useRef(settings);
  useEffect(() => {
    latestSettings.current = settings;
  }, [settings]);
  return latestSettings;
}

/** The settings with `edit` applied to their saved indicators. */
function withEditedIndicators(settings: ChartSettings, edit: IndicatorListEdit): ChartSettings {
  return withIndicators(settings, edit(settings.indicators));
}

/**
 * What an indicator's row does to the saved indicators, in the legend or the object tree: each command
 * saves, and the chart follows the list.
 */
export interface IndicatorRowCommands {
  readonly setHidden: (instanceId: string, hidden: boolean) => void;
  readonly remove: (instanceId: string) => void;
  /** Saves the heights the user dragged the pane separators to, relative to the price pane. */
  readonly setPaneHeights: (heights: readonly IndicatorPaneHeight[]) => void;
  /** Saves whether the legend's rows are collapsed to their count, which the legend's chevron edits. */
  readonly setLegendCollapsed: (collapsed: boolean) => void;
  /**
   * Moves one price-pane indicator to the row another one holds, which saves the order of the tree's rows:
   * the chart paints the first of them over the ones under it.
   */
  readonly moveIndicatorRow: (movedInstanceId: string, targetInstanceId: string) => void;
  /**
   * Puts the price-pane indicators in the given top-to-bottom order and names how many of them paint over the price
   * bars, which is what the object tree's rows say once one of them crosses the bars row.
   */
  readonly setPricePaneOrder: (order: readonly string[], aboveBars: number) => void;
}

/** What the settings dialog does to one saved indicator: OK saves its settings, while a preview only shows them. */
export interface IndicatorSettingsCommands {
  readonly setSettings: (
    instanceId: string,
    values: SettingValues,
    timeframeVisibility?: DrawingTimeframeVisibility,
  ) => void;
  /** Shows the edited settings on the chart without saving them; OK saves them, a revert shows the saved ones. */
  readonly previewSettings: (instanceId: string, values: SettingValues) => void;
  readonly revertPreview: () => void;
}

/**
 * The commands of an indicator's row: hide or show one saved indicator, detach it, move it among its pane's
 * rows, save the heights of the panes the user resized, and save the legend's collapsed state. Every one saves
 * the settings through the chart settings, which the chart's sync follows.
 */
export function useIndicatorRowCommands(): IndicatorRowCommands {
  const { keep } = useChartSettings();
  const latestSettings = useLatestSettings();

  // The commands keep the identity of the chart's own saving commands, so a row that holds them is not
  // re-registered with the legend on every settings change.
  return useMemo<IndicatorRowCommands>(
    () => ({
      setHidden: (instanceId, hidden) =>
        keep(withEditedIndicators(latestSettings.current, (saved) => withIndicatorHidden(saved, instanceId, hidden))),
      remove: (instanceId) =>
        keep(withEditedIndicators(latestSettings.current, (saved) => withoutIndicator(saved, instanceId))),
      setPaneHeights: (heights) =>
        keep(withEditedIndicators(latestSettings.current, (saved) => withIndicatorPaneHeights(saved, heights))),
      setLegendCollapsed: (collapsed) =>
        keep(withStatusLineValue(latestSettings.current, 'indicatorLegendCollapsed', collapsed)),
      moveIndicatorRow: (movedInstanceId, targetInstanceId) =>
        keep(
          withEditedIndicators(latestSettings.current, (saved) =>
            withIndicatorMoved(saved, movedInstanceId, targetInstanceId),
          ),
        ),
      setPricePaneOrder: (order, aboveBars) =>
        keep(withEditedIndicators(latestSettings.current, (saved) => withPricePaneOrder(saved, order, aboveBars))),
    }),
    [keep, latestSettings],
  );
}

/**
 * The commands of one indicator's settings dialog: OK saves the edited settings along with the timeframes the
 * indicator shows on, a preview only shows them, and a revert shows the saved ones again.
 */
export function useIndicatorSettingsCommands(): IndicatorSettingsCommands {
  const { keep, preview, revert } = useChartSettings();
  const latestSettings = useLatestSettings();

  return useMemo<IndicatorSettingsCommands>(
    () => ({
      setSettings: (instanceId, values, timeframeVisibility) =>
        keep(
          withEditedIndicators(latestSettings.current, (saved) =>
            withIndicatorSettings(saved, instanceId, values, timeframeVisibility),
          ),
        ),
      previewSettings: (instanceId, values) =>
        preview(
          withEditedIndicators(latestSettings.current, (saved) => withIndicatorSettings(saved, instanceId, values)),
        ),
      revertPreview: () => revert(),
    }),
    [keep, preview, revert, latestSettings],
  );
}
