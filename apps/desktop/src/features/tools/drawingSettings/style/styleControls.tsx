import { LabelledCheckbox } from '../LabelledCheckbox';

interface VisibleCheckboxProps {
  readonly title: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}

/** The visible checkbox of a style row, labelled by the style's title. */
export function VisibleCheckbox({ title, checked, disabled, onChange }: VisibleCheckboxProps) {
  return (
    <LabelledCheckbox
      className="drawing-settings-style-title"
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    >
      <span>{title}</span>
    </LabelledCheckbox>
  );
}
