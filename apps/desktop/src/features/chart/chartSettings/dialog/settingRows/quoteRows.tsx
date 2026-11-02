import { ColorPickerButton } from '../../../../../shared/ui/colorPicker/ColorPickerButton';
import type { SelectOption } from '../../../../../shared/ui/select/Select';
import { QUOTE_LINE_MODES, type QuoteLineMode } from '../../settingFields';
import { SelectWithSwatches } from './selectWithSwatches';
import type { SettingRowProps } from './settingRowProps';

const QUOTE_LINE_MODE_LABELS: Readonly<Record<QuoteLineMode, string>> = {
  lineAndLabel: 'Line and label',
  line: 'Line',
  label: 'Label',
  hidden: 'Hidden',
};

const QUOTE_LINE_MODE_OPTIONS: readonly SelectOption[] = QUOTE_LINE_MODES.map((mode) => ({
  value: mode,
  label: QUOTE_LINE_MODE_LABELS[mode],
}));

/** The mode an option names; the select only ever names one of the four the field holds. */
function quoteLineModeOf(choice: string): QuoteLineMode {
  return QUOTE_LINE_MODES.find((mode) => mode === choice) ?? 'lineAndLabel';
}

export function QuoteLinesSettingRow({ field, value, onChange }: SettingRowProps<'quoteLines'>) {
  const lines = typeof value === 'object' && 'bid' in value && 'ask' in value ? value : field.defaultValue;
  return (
    <SelectWithSwatches
      label={field.label}
      selectLabel={`${field.label} display`}
      options={QUOTE_LINE_MODE_OPTIONS}
      value={lines.mode}
      onChange={(choice) => onChange({ ...lines, mode: quoteLineModeOf(choice) })}
    >
      <ColorPickerButton label="Bid colour" color={lines.bid} onColorChange={(bid) => onChange({ ...lines, bid })} />
      <ColorPickerButton label="Ask colour" color={lines.ask} onColorChange={(ask) => onChange({ ...lines, ask })} />
    </SelectWithSwatches>
  );
}
