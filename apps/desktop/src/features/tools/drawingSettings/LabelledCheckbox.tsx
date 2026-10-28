import type { ReactNode } from 'react';

interface LabelledCheckboxProps {
  /** The class of the wrapping label, which the tab's stylesheet rules lay out. */
  readonly className: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
  /** The label text, which names the checkbox. */
  readonly children: ReactNode;
}

/** A checkbox wrapped in the label that names it, as the settings tabs lay their toggles out. */
export function LabelledCheckbox({ className, checked, disabled, onChange, children }: LabelledCheckboxProps) {
  return (
    <label className={className}>
      <input
        className="drawing-settings-checkbox"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {children}
    </label>
  );
}
