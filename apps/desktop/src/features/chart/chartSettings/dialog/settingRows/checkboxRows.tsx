import { LabelledCheckbox } from '../../../../tools/drawingSettings/LabelledCheckbox';
import type { SettingRowProps } from './settingRowProps';

/** A checkbox whose label is the row's only text, so the row spans the panel. */
export function CheckboxSettingRow({ field, value, onChange }: SettingRowProps<'checkbox'>) {
  const checked = typeof value === 'boolean' ? value : field.defaultValue;
  return (
    <LabelledCheckbox className="chart-settings-checkbox-row" checked={checked} onChange={onChange}>
      {field.label}
    </LabelledCheckbox>
  );
}
