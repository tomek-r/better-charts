import type { SettingValues } from '../chart/engine/settings/settingInputs';

/**
 * Settings arrive resolved, so the fallback only covers a stored value of the
 * wrong kind.
 */
export function numberSetting(settings: SettingValues, key: string, fallback: number): number {
  const value = settings[key];
  return typeof value === 'number' ? value : fallback;
}

/** Settings arrive resolved, so the fallback only covers a value of the wrong kind. */
export function stringSetting(settings: SettingValues, key: string, fallback: string): string {
  const value = settings[key];
  return typeof value === 'string' ? value : fallback;
}
