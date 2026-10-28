interface VisibleCheckboxProps {
  readonly title: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** The visible checkbox of a style row, labelled by the style's title. */
export function VisibleCheckbox({ title, checked, disabled, onChange }: VisibleCheckboxProps) {
  return (
    <label className="drawing-settings-style-title">
      <input
        className="drawing-settings-checkbox"
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{title}</span>
    </label>
  );
}
