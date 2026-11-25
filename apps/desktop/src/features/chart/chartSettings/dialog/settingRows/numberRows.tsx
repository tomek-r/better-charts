import { BAR_COUNT_RANGE, PERCENT_RANGE, type NumberRange } from '../../settingFields';
import type { SettingRowProps } from './settingRowProps';

/** The number a field's text names within its range, or undefined while it names none or breaks a whole count. */
function numberInRange(text: string, range: NumberRange, whole: boolean): number | undefined {
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value) || (whole && !Number.isInteger(value))) {
    return undefined;
  }
  return value < range.min || value > range.max ? undefined : value;
}

interface NumberRowProps {
  /** The field the row edits: its label names the input, and its unit follows one. */
  readonly field: { readonly label: string; readonly unit?: string };
  readonly range: NumberRange;
  /** What one edit moves the value by, which is one whole thing unless the field says otherwise. */
  readonly step?: number;
  /** Whether the field counts whole things, such as bars or percents, and refuses a fraction. */
  readonly whole?: boolean;
  readonly value: number;
  readonly onChange: (value: number) => void;
}

/** A number: the label, the input that holds it and the unit it counts in after the input. */
function NumberRow({ field, range, step = 1, whole = true, value, onChange }: NumberRowProps) {
  const { label, unit } = field;
  return (
    <>
      <span>{label}</span>
      <div className="chart-settings-controls">
        <input
          className="drawing-settings-control chart-settings-number"
          type="number"
          min={range.min}
          max={range.max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => {
            const edited = numberInRange(event.target.value, range, whole);
            if (edited !== undefined) {
              onChange(edited);
            }
          }}
        />
        {unit === undefined ? null : <span className="chart-settings-unit">{unit}</span>}
      </div>
    </>
  );
}

export function PercentSettingRow({ field, value, onChange }: SettingRowProps<'percent'>) {
  const count = typeof value === 'number' ? value : field.defaultValue;
  return <NumberRow field={field} range={PERCENT_RANGE} value={count} onChange={onChange} />;
}

export function BarCountSettingRow({ field, value, onChange }: SettingRowProps<'barCount'>) {
  const count = typeof value === 'number' ? value : field.defaultValue;
  return <NumberRow field={field} range={BAR_COUNT_RANGE} value={count} onChange={onChange} />;
}

/** A number a chart type's own rule reads: it keeps the fraction the type allows, such as a brick's box size. */
export function DecimalSettingRow({ field, value, onChange }: SettingRowProps<'decimal'>) {
  const number = typeof value === 'number' ? value : field.defaultValue;
  const { range } = field;
  return <NumberRow field={field} range={range} step={range.step} whole={false} value={number} onChange={onChange} />;
}

/** A whole number a field counts, such as the bars an average spans: its own range, and no fraction. */
export function WholeNumberSettingRow({ field, value, onChange }: SettingRowProps<'wholeNumber'>) {
  const count = typeof value === 'number' ? value : field.defaultValue;
  return <NumberRow field={field} range={field.range} value={count} onChange={onChange} />;
}
