import type { MT5BridgeSettings } from '../../shared/bridge/types';

export interface AppSettingsData {
  mt5BridgeSettings: MT5BridgeSettings;
  configured: boolean;
  firstLaunch: boolean;
  restartRequired: boolean;
  platform: 'windows' | 'macos' | 'linux';
  overriddenKeys: string[];
  configurationError: string | null;
}
