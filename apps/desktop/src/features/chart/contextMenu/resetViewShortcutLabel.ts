import type { AppSettingsData } from '../../settings/appSettingsData';

/** The reset-view shortcut as the platform writes it; `useResetChartViewShortcut` matches the same binding. */
export function resetViewShortcutLabel(platform: AppSettingsData['platform']): string {
  return platform === 'macos' ? '⌥R' : 'Ctrl+R';
}
