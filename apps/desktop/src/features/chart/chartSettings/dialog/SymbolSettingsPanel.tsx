import { BAR_STYLE_SETTINGS } from '../barStyleSettings';
import { withSettingValue, withTimeZone, type ChartSettings } from '../chartSettings';
import type { ChartSettingValue } from '../settingFields';
import { SettingFieldRow } from './SettingFieldRow';
import { TimeZoneSettingRow } from './TimeZoneSettingRow';

/** What every tab's panel edits: the draft settings of the dialog, and the way to replace them. */
export interface ChartSettingsPanelProps {
  readonly settings: ChartSettings;
  readonly onChange: (settings: ChartSettings) => void;
}

/** The Symbol tab: the fields the bar type on screen declares, then the zone the chart draws its times in. */
export function SymbolSettingsPanel({ settings, onChange }: ChartSettingsPanelProps) {
  const { barStyle } = settings;
  const section = BAR_STYLE_SETTINGS[barStyle];
  const values = settings.barStyles[barStyle];
  const setValue = (key: string, value: ChartSettingValue) =>
    onChange(withSettingValue(settings, barStyle, key, value));
  return (
    <>
      <section className="chart-settings-section">
        <h3 className="chart-settings-section-title">{section.title}</h3>
        <div className="chart-settings-rows">
          {section.fields.map((field) => (
            <SettingFieldRow
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={(value) => setValue(field.key, value)}
            />
          ))}
        </div>
      </section>
      <TimeZoneSettingRow zone={settings.timeZone} onChange={(zone) => onChange(withTimeZone(settings, zone))} />
    </>
  );
}
