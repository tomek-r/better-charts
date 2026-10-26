import type { HTMLInputTypeAttribute } from 'react';
import type { CoordinateFieldName } from './coordinateText';

/** How each field of an anchor is shown: its name in the accessible label and the input it uses. */
const FIELD_INPUTS: Readonly<
  Record<CoordinateFieldName, { readonly title: string; readonly type: HTMLInputTypeAttribute; readonly step?: number }>
> = {
  date: { title: 'date', type: 'date' },
  // One-second steps, so the browser shows the seconds a bar time may carry.
  time: { title: 'time', type: 'time', step: 1 },
  price: { title: 'price', type: 'text' },
};

export interface CoordinateFieldProps {
  /** The anchor the field belongs to, e.g. `#2`; it prefixes the accessible label. */
  readonly rowLabel: string;
  readonly name: CoordinateFieldName;
  readonly value: string;
  readonly invalid: boolean;
  readonly onChange: (text: string) => void;
}

/** One field of an anchor: a date, a time of day (both UTC) or a decimal price. */
export function CoordinateField({ rowLabel, name, value, invalid, onChange }: CoordinateFieldProps) {
  const { title, type, step } = FIELD_INPUTS[name];
  return (
    <input
      className="drawing-settings-control"
      type={type}
      step={step}
      inputMode={name === 'price' ? 'decimal' : undefined}
      autoComplete="off"
      aria-label={`${rowLabel} ${title}`}
      aria-invalid={invalid}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
