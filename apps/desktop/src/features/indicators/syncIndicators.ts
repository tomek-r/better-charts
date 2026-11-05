import type { SavedIndicator } from '../chart/chartSettings/savedIndicators';
import type { IndicatorRuntime } from '../chart/engine/indicators/indicatorRuntime';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../chart/engine/settings/settingsSchema';
import { findChartIndicatorPlugin, type RegisteredChartIndicatorPlugin } from './registry';

type IndicatorSyncRuntime = Pick<IndicatorRuntime, 'attach' | 'detach' | 'attachedState'>;

/**
 * Makes the attached indicators match the saved ones: an attached instance the settings no longer keep is
 * detached, a saved instance the chart does not show yet is attached with the settings it was saved with, and
 * an instance already attached with those same resolved settings is left alone, so it is not reloaded.
 * A saved instance this build does not register is skipped, since only a build that knows its definition can
 * draw it; it stays saved for the build that does.
 */
export function syncIndicators(runtime: IndicatorSyncRuntime, saved: readonly SavedIndicator[]): void {
  detachUnkeptInstances(runtime, saved);
  for (const indicator of saved) {
    attachUnlessAlreadyAttached(runtime, indicator);
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

function attachUnlessAlreadyAttached(runtime: IndicatorSyncRuntime, saved: SavedIndicator): void {
  const plugin = findChartIndicatorPlugin(saved.definitionId);
  if (plugin === undefined) {
    return;
  }
  if (showsSavedInstance(runtime, saved, plugin)) {
    return;
  }
  runtime.attach(saved.instanceId, saved.definitionId, saved.settings);
}

/** Whether the chart already shows the instance with the definition and the settings the saved one resolves to. */
function showsSavedInstance(
  runtime: IndicatorSyncRuntime,
  saved: SavedIndicator,
  plugin: RegisteredChartIndicatorPlugin,
): boolean {
  const attached = runtime.attachedState().find((instance) => instance.instanceId === saved.instanceId);
  if (attached === undefined || attached.definitionId !== saved.definitionId) {
    return false;
  }
  return sameResolvedSettings(attached.settings, resolveSettingValues(plugin, saved.settings));
}

function sameResolvedSettings(left: SettingValues, right: SettingValues): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}
