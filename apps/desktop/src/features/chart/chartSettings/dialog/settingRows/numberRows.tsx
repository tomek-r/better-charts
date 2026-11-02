import { BAR_COUNT_RANGE, PERCENT_RANGE, type NumberRange } from '../../settingFields';
import type { SettingRowProps } from './settingRowProps';

/** The whole number a field's text names within its range, or undefined while it names none. */
function wholeNumberInRange(text: string, range: NumberRange): number | undefined {
  const count = Number(text);
  if (text.trim() === '' || !Number.isInteger(count) || count < range.min || count > range.max) {
    return undefined;
  }
  return count;
}

interface NumberRowProps {
  readonly label: string;
  readonly unit: string | undefined;
  readonly range: NumberRange;
  readonly value: number;
  readonly onChange: (value: number) => void;
}

/** A whole number: the label, the input that holds it and the unit it counts in after the input. */
function NumberRow({ label, unit, range, value, onChange }: NumberRowProps) {
  return (
    <>
      <span>{label}</span>
      <div className="chart-settings-controls">
        <input
          className="drawing-settings-control chart-settings-number"
          type="number"
          min={range.min}
          max={range.max}
          step={1}
          value={value}
          aria-label={label}
          onChange={(event) => {
            const edited = wholeNumberInRange(event.target.value, range);
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
  return <NumberRow label={field.label} unit={field.unit} range={PERCENT_RANGE} value={count} onChange={onChange} />;
}

export function BarCountSettingRow({ field, value, onChange }: SettingRowProps<'barCount'>) {
  const count = typeof value === 'number' ? value : field.defaultValue;
  return <NumberRow label={field.label} unit={field.unit} range={BAR_COUNT_RANGE} value={count} onChange={onChange} />;
}
