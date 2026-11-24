import { barStyleSettingSections } from '../barStyleSettings';
import { withSettingValue, withTimeZone } from '../chartSettings';
import type { ChartSettingValue } from '../settingFields';
import type { ChartSettingsPanelProps } from './chartSettingsPanelProps';
import { SettingsSection } from './SettingsSection';
import { TimeZoneSettingRow } from './TimeZoneSettingRow';

/** The Symbol tab: the fields the bar type on screen declares, then the zone the chart draws its times in. */
export function SymbolSettingsPanel({ settings, onChange }: ChartSettingsPanelProps) {
  const { barStyle } = settings;
  const values = settings.barStyles[barStyle];
  const setValue = (key: string, value: ChartSettingValue) =>
    onChange(withSettingValue(settings, barStyle, key, value));
  return (
    <>
      {barStyleSettingSections(barStyle).map((section) => (
        <SettingsSection key={section.title} section={section} values={values} onChange={setValue} />
      ))}
      <TimeZoneSettingRow zone={settings.timeZone} onChange={(zone) => onChange(withTimeZone(settings, zone))} />
    </>
  );
}
