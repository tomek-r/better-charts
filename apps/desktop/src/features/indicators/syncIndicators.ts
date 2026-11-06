import type { SavedIndicator } from '../chart/chartSettings/savedIndicators';
import { indicatorSettingsSchema } from '../chart/engine/indicators/indicatorDisplaySettings';
import type { IndicatorRuntime } from '../chart/engine/indicators/indicatorRuntime';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../chart/engine/settings/settingsSchema';
import { findChartIndicatorPlugin, type RegisteredChartIndicatorPlugin } from './registry';

type IndicatorSyncRuntime = Pick<IndicatorRuntime, 'attach' | 'detach' | 'attachedState' | 'setHidden' | 'setSettings'>;

/**
 * Makes the attached indicators match the saved ones: an attached instance the settings no longer keep is
 * detached, a saved instance the chart does not show yet is attached with the settings and the pane height it
 * was saved with, an instance attached with the same definition and other settings is reloaded where it is, so
 * it keeps its own pane, the choices made on that pane and its place among the panes, and an instance already
 * attached with those same resolved settings is left alone, so it is not reloaded. The hidden flag follows the
 * saved one too, without reloading an indicator whose visibility alone changed. A saved instance this build does
 * not register is skipped, since only a build that knows its definition can draw it; it stays saved for the
 * build that does.
 */
export function syncIndicators(runtime: IndicatorSyncRuntime, saved: readonly SavedIndicator[]): void {
  detachUnkeptInstances(runtime, saved);
  for (const indicator of saved) {
    syncSavedInstance(runtime, indicator);
    // A hidden indicator stays attached and draws nothing; the runtime ignores an id it does not hold.
    runtime.setHidden(indicator.instanceId, indicator.hidden === true);
  }
}

function detachUnkeptInstances(runtime: IndicatorSyncRuntime, saved: readonly SavedIndicator[]): void {
  const keptInstanceIds = new Set(saved.map((indicator) => indicator.instanceId));
  for (const attached of runtime.attachedState()) {
    if (!keptInstanceIds.has(attached.instanceId)) {
      runtime.detach(attached.instanceId);
    }
  }
}

/** Attaches the saved instance, or reloads the one already attached when only its settings moved. */
function syncSavedInstance(runtime: IndicatorSyncRuntime, saved: SavedIndicator): void {
  const plugin = findChartIndicatorPlugin(saved.definitionId);
  if (plugin === undefined) {
    return;
  }
  const attached = runtime.attachedState().find((instance) => instance.instanceId === saved.instanceId);
  if (attached === undefined || attached.definitionId !== saved.definitionId) {
    runtime.attach(saved.instanceId, saved.definitionId, saved.settings, saved.paneHeight);
    return;
  }
  if (!sameResolvedSettings(attached.settings, resolvedSettings(saved, plugin))) {
    runtime.setSettings(saved.instanceId, saved.settings);
  }
}

function resolvedSettings(saved: SavedIndicator, plugin: RegisteredChartIndicatorPlugin): SettingValues {
  // The runtime resolves with the display switches too, so this side resolves with the same schema.
  return resolveSettingValues(indicatorSettingsSchema(plugin), saved.settings);
}

function sameResolvedSettings(left: SettingValues, right: SettingValues): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}
