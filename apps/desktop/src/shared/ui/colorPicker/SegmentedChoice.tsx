import type { ReactNode } from 'react';

export interface SegmentedOption<Value extends string | number> {
  readonly value: Value;
  /** The option's accessible name; its look is the `preview`. */
  readonly label: string;
  readonly preview: ReactNode;
}

interface SegmentedChoiceProps<Value extends string | number> {
  /** Names the group, e.g. "Thickness". */
  readonly label: string;
  readonly options: readonly SegmentedOption<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}

/** A row of toggle buttons of which exactly one is pressed, each drawn as a preview of its value. */
export function SegmentedChoice<Value extends string | number>({
  label,
  options,
  value,
  onChange,
}: SegmentedChoiceProps<Value>) {
  return (
    <div className="color-option-group">
      <span className="color-section-title">{label}</span>
      <div className="color-segmented" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className="color-segment"
            aria-label={option.label}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.preview}
          </button>
        ))}
      </div>
    </div>
  );
}
