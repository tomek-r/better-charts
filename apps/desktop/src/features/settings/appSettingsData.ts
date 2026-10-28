import type { MT5BridgeSettings } from '../../shared/bridge/types';

/** Installation paths MT5 detection can fill, named the way the form names them. */
export type DetectedSettingsField = 'terminalPath' | 'winePrefix' | 'wineBinary';

export interface AppSettingsData {
  mt5BridgeSettings: MT5BridgeSettings;
  configured: boolean;
  firstLaunch: boolean;
  restartRequired: boolean;
  platform: 'windows' | 'macos' | 'linux';
  overriddenKeys: string[];
  /** Fields this load filled from an MT5 installation detected on this computer. */
  detectedFields: DetectedSettingsField[];
  configurationError: string | null;
}
