import { withScalesValue } from '../chartSettings';
import { SCALES_SETTINGS } from '../scalesSettings';
import type { ChartSettingValue } from '../settingFields';
import type { ChartSettingsPanelProps } from './chartSettingsPanelProps';
import { GroupSettingsPanel } from './GroupSettingsPanel';

/** The Scales and lines tab: the price scale, the labels and lines it draws, and the time scale. */
export function ScalesSettingsPanel({ settings, onChange }: ChartSettingsPanelProps) {
  const setValue = (key: string, value: ChartSettingValue) => onChange(withScalesValue(settings, key, value));
  return <GroupSettingsPanel sections={SCALES_SETTINGS} values={settings.scales} onChange={setValue} />;
}
