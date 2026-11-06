import { CommandButton } from '../../shared/ui/button/CommandButton';
import { ToggleCommandButton, type ToggleCommandLabels } from '../../shared/ui/button/ToggleCommandButton';
import { EyeCrossedIcon, EyeIcon, TrashIcon } from '../tools/drawingToolbar/drawingToolbarIcons';

/** The class of the small icon buttons of a row's actions. */
export const ROW_ACTION_CLASS = 'object-tree-row-action';

/**
 * The visibility toggle shared by every object tree row, so drawing rows and
 * indicator rows show and flip the same control instead of duplicating it.
 */
export function ObjectTreeVisibilityButton({
  labels,
  hidden,
  onToggle,
}: {
  readonly labels: ToggleCommandLabels;
  readonly hidden: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <ToggleCommandButton
      className={ROW_ACTION_CLASS}
      labels={labels}
      pressed={hidden}
      offIcon={<EyeIcon />}
      onIcon={<EyeCrossedIcon />}
      onClick={onToggle}
    />
  );
}

/**
 * The remove button shared by every object tree row, so both row kinds delete
 * their item through the same control.
 */
export function ObjectTreeRemoveButton({ label, onRemove }: { readonly label: string; readonly onRemove: () => void }) {
  return (
    <CommandButton className={ROW_ACTION_CLASS} label={label} onClick={onRemove}>
      <TrashIcon />
    </CommandButton>
  );
}
