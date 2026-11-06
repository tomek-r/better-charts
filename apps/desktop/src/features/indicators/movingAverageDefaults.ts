import type { SettingInputSource } from '../chart/engine/settings/settingInputs';
import type { WindowSettings } from './closedValueWindow';

// The SMA and the EMA start from the same line, so both read their defaults here.
export const PLOT_STYLE = 'plot';
export const DEFAULT_LENGTH = 9;
export const DEFAULT_SOURCE: SettingInputSource = 'close';
export const DEFAULT_COLOR = '#2962FF';
export const DEFAULT_WIDTH = 1;

export const WINDOW_DEFAULTS: WindowSettings = { length: DEFAULT_LENGTH, source: DEFAULT_SOURCE };
