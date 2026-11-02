import { Select, type SelectOption } from '../../../../../shared/ui/select/Select';
import type { SettingRowProps } from './settingRowProps';

/** The widths a line is drawn with, as the drop-down writes them. */
const LINE_WIDTH_OPTIONS: readonly SelectOption[] = [1, 2, 3, 4].map((width) => ({
  value: String(width),
  label: `${width}px`,
}));

export function LineWidthSettingRow({ field, value, onChange }: SettingRowProps<'lineWidth'>) {
  const width = typeof value === 'number' ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <Select
        ariaLabel={field.label}
        options={LINE_WIDTH_OPTIONS}
        value={String(width)}
        onChange={(chosen) => onChange(Number(chosen))}
      />
    </>
  );
}

export function ChoiceSettingRow({ field, value, onChange }: SettingRowProps<'choice'>) {
  const choice = typeof value === 'string' ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <Select ariaLabel={field.label} options={field.options} value={choice} onChange={onChange} />
    </>
  );
}
