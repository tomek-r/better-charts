import type { ChartSettingField, ChartSettingValue, SettingsSectionFields } from '../settingFields';
import { SettingFieldRow } from './SettingFieldRow';

interface SettingsSectionProps {
  readonly section: SettingsSectionFields;
  readonly values: Readonly<Record<string, ChartSettingValue>>;
  readonly onChange: (key: string, value: ChartSettingValue) => void;
}

/** Whether `field` is drawn for `values`: a row that names a switch shows only while that switch holds its value. */
function shownFor(field: ChartSettingField, values: Readonly<Record<string, ChartSettingValue>>): boolean {
  const visibility = field.visibleWhen;
  if (visibility === undefined) {
    return true;
  }
  return visibility.values.some((value) => value === values[visibility.key]);
}

/** The fields of one section that the values on screen show, in the order the section declares them. */
function visibleFields(
  fields: readonly ChartSettingField[],
  values: Readonly<Record<string, ChartSettingValue>>,
): readonly ChartSettingField[] {
  return fields.filter((field) => shownFor(field, values));
}

/** A titled group of settings: one caption, then a row for every field the section shows. */
export function SettingsSection({ section, values, onChange }: SettingsSectionProps) {
  return (
    <section>
      <h3>{section.title}</h3>
      {visibleFields(section.fields, values).map((field) => (
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
