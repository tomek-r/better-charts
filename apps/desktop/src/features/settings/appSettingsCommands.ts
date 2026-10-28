import { invoke } from '@tauri-apps/api/core';
import type { MT5BridgeSettings } from '../../shared/bridge/types';
import type { AppSettingsData } from './appSettingsData';

export function loadAppSettings(): Promise<AppSettingsData> {
  return invoke<AppSettingsData>('get_app_settings');
}

export function saveAppSettings(settings: MT5BridgeSettings): Promise<AppSettingsData> {
  return invoke<AppSettingsData>('save_app_settings', { settings });
}
