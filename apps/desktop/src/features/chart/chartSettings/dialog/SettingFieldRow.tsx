import type { ReactNode } from 'react';
import { ColorPickerButton } from '../../../../shared/ui/colorPicker/ColorPickerButton';
import { Select, type SelectOption } from '../../../../shared/ui/select/Select';
import { LabelledCheckbox } from '../../../tools/drawingSettings/LabelledCheckbox';
import type { ChartSettingField, ChartSettingValue, ColorPairValue } from '../settingFields';

/** What one row edits: the field it declares, the draft's value, and the way to replace it. */
export interface SettingRowProps<Kind extends ChartSettingField['kind']> {
  readonly field: Extract<ChartSettingField, { kind: Kind }>;
  readonly value: ChartSettingValue;
  readonly onChange: (value: ChartSettingValue) => void;
}

/** The widths a line is drawn with, as the drop-down writes them. */
const LINE_WIDTH_OPTIONS: readonly SelectOption[] = [1, 2, 3, 4].map((width) => ({
  value: String(width),
  label: `${width}px`,
}));

const MIN_PERCENT = 0;
const MAX_PERCENT = 100;

/** The whole percent a field's text names, or undefined while it names none: a fraction is ignored. */
function percentFromText(text: string): number | undefined {
  const percent = Number(text);
  if (text.trim() === '' || !Number.isInteger(percent) || percent < MIN_PERCENT || percent > MAX_PERCENT) {
    return undefined;
  }
  return percent;
}

/** The up and down colour of a pair, each named after the field so a picker is never just "up colour". */
function ColorPairPickers({
  label,
  pair,
  onChange,
}: {
  label: string;
  pair: ColorPairValue;
  onChange: (pair: ColorPairValue) => void;
}) {
  return (
    <div className="chart-settings-colors">
      <ColorPickerButton
        label={`${label} up colour`}
        color={pair.up}
        onColorChange={(up) => onChange({ up, down: pair.down })}
      />
      <ColorPickerButton
        label={`${label} down colour`}
        color={pair.down}
        onColorChange={(down) => onChange({ up: pair.up, down })}
      />
    </div>
  );
}

function CheckboxSettingRow({ field, value, onChange }: SettingRowProps<'checkbox'>) {
  const checked = typeof value === 'boolean' ? value : field.defaultValue;
  return (
    <LabelledCheckbox className="chart-settings-checkbox-row" checked={checked} onChange={onChange}>
      {field.label}
    </LabelledCheckbox>
  );
}

function ToggledColorPairSettingRow({ field, value, onChange }: SettingRowProps<'toggledColorPair'>) {
  const pair = typeof value === 'object' && 'visible' in value ? value : field.defaultValue;
  return (
    <>
      <LabelledCheckbox
        className="chart-settings-checkbox-row"
        checked={pair.visible}
        onChange={(visible) => onChange({ ...pair, visible })}
      >
        {field.label}
      </LabelledCheckbox>
      <ColorPairPickers
        label={field.label}
        pair={pair}
        onChange={(colors) => onChange({ ...colors, visible: pair.visible })}
      />
    </>
  );
}

function ColorPairSettingRow({ field, value, onChange }: SettingRowProps<'colorPair'>) {
  const pair = typeof value === 'object' ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <ColorPairPickers label={field.label} pair={pair} onChange={onChange} />
    </>
  );
}

function ColorSettingRow({ field, value, onChange }: SettingRowProps<'color'>) {
  const color = typeof value === 'string' ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <ColorPickerButton label={field.label} color={color} onColorChange={onChange} />
    </>
  );
}

function LineWidthSettingRow({ field, value, onChange }: SettingRowProps<'lineWidth'>) {
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

function ChoiceSettingRow({ field, value, onChange }: SettingRowProps<'choice'>) {
  const choice = typeof value === 'string' ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <Select ariaLabel={field.label} options={field.options} value={choice} onChange={onChange} />
    </>
  );
}

function PercentSettingRow({ field, value, onChange }: SettingRowProps<'percent'>) {
  const percent = typeof value === 'number' ? value : field.defaultValue;
  return (
    <>
      <span>{field.label}</span>
      <input
        className="drawing-settings-control chart-settings-number"
        type="number"
        min={MIN_PERCENT}
        max={MAX_PERCENT}
        step={1}
        value={percent}
        aria-label={field.label}
        onChange={(event) => {
          const edited = percentFromText(event.target.value);
          if (edited !== undefined) {
            onChange(edited);
          }
        }}
      />
    </>
  );
}

/** What each kind's row draws: a new kind is one entry here, and TypeScript refuses a table that misses one. */
const SETTING_ROWS: {
  readonly [Kind in ChartSettingField['kind']]: (props: SettingRowProps<Kind>) => ReactNode;
} = {
  checkbox: CheckboxSettingRow,
  toggledColorPair: ToggledColorPairSettingRow,
  colorPair: ColorPairSettingRow,
  color: ColorSettingRow,
  lineWidth: LineWidthSettingRow,
  choice: ChoiceSettingRow,
  percent: PercentSettingRow,
};

/** The table indexed by one kind is the union of its entries; this names the one call, as the input fields do. */
type RenderSettingRow = (props: SettingRowProps<ChartSettingField['kind']>) => ReactNode;

interface SettingFieldRowProps {
  readonly field: ChartSettingField;
  readonly value: ChartSettingValue;
  readonly onChange: (value: ChartSettingValue) => void;
}

/** A checkbox has no control beside its label, so its row spans the panel and the label stays on one line. */
function rowClassName(kind: ChartSettingField['kind']): string {
  return kind === 'checkbox' ? 'chart-settings-row chart-settings-row-wide' : 'chart-settings-row';
}

/** One row of the settings dialog: the control the field's kind asks for, beside the label that names it. */
export function SettingFieldRow({ field, value, onChange }: SettingFieldRowProps) {
  const render = SETTING_ROWS[field.kind] as RenderSettingRow;
  return <div className={rowClassName(field.kind)}>{render({ field, value, onChange })}</div>;
}
