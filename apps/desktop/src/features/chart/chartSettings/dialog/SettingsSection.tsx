import type { ChartSettingValue, SettingsSectionFields } from '../settingFields';
import { SettingFieldRow } from './SettingFieldRow';

interface SettingsSectionProps {
  readonly section: SettingsSectionFields;
  readonly values: Readonly<Record<string, ChartSettingValue>>;
  readonly onChange: (key: string, value: ChartSettingValue) => void;
}

/** A titled group of settings: one caption, then a row for every field the section declares. */
export function SettingsSection({ section, values, onChange }: SettingsSectionProps) {
  return (
    <section>
      <h3>{section.title}</h3>
      {section.fields.map((field) => (
        <SettingFieldRow
          key={field.key}
          field={field}
          value={values[field.key]}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
    </section>
  );
}
