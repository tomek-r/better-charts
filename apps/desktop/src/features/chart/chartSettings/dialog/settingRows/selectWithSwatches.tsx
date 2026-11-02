import type { ReactNode } from 'react';
import { Select, type SelectOption } from '../../../../../shared/ui/select/Select';

interface SelectWithSwatchesProps {
  /** The row's label, drawn beside the controls. */
  readonly label: string;
  /** The select's accessible name: the swatches beside it carry names of their own. */
  readonly selectLabel: string;
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly onChange: (choice: string) => void;
  /** The swatches of what the choice draws, in the order they are drawn. */
  readonly children: ReactNode;
}

/** A row's control column: the select that names what is drawn, and the swatches of what it draws. */
export function SelectWithSwatches({
  label,
  selectLabel,
  options,
  value,
  onChange,
  children,
}: SelectWithSwatchesProps) {
  return (
    <>
      <span>{label}</span>
      <div className="chart-settings-controls">
        <Select ariaLabel={selectLabel} options={options} value={value} onChange={onChange} />
        {children}
      </div>
    </>
  );
}
