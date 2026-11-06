import { withStatusLineValue } from '../chartSettings';
import type { ChartSettingValue } from '../settingFields';
import { STATUS_LINE_SETTINGS } from '../statusLineSettings';
import type { ChartSettingsPanelProps } from './chartSettingsPanelProps';
import { GroupSettingsPanel } from './GroupSettingsPanel';

/** The Status line tab: what the OHLC line and the indicator legend rows show. */
export function StatusLineSettingsPanel({ settings, onChange }: ChartSettingsPanelProps) {
  const setValue = (key: string, value: ChartSettingValue) => onChange(withStatusLineValue(settings, key, value));
  return <GroupSettingsPanel sections={STATUS_LINE_SETTINGS} values={settings.statusLine} onChange={setValue} />;
}
