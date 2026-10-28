import type { AppSettingsData } from '../settings/appSettingsData';

/** The symbol-search shortcut as the platform writes it; the handler accepts Cmd or Ctrl on every platform. */
export function searchShortcutLabel(platform: AppSettingsData['platform']): string {
  return platform === 'macos' ? '⌘K' : 'Ctrl+K';
}
