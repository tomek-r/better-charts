import { CommandButton } from '../../shared/ui/button/CommandButton';
import { ToggleCommandButton, type ToggleCommandLabels } from '../../shared/ui/button/ToggleCommandButton';
import { EyeCrossedIcon, EyeIcon, TrashIcon } from '../../shared/ui/icons/drawingActionIcons';

/** The class of the small icon buttons of a row's actions. */
export const ROW_ACTION_CLASS = 'object-tree-row-action';

/** The class of the glyph inside a row's action button; object-tree.css sizes it. */
export const ROW_ACTION_ICON_CLASS = 'object-tree-action-icon';

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
      offIcon={<EyeIcon className={ROW_ACTION_ICON_CLASS} />}
      onIcon={<EyeCrossedIcon className={ROW_ACTION_ICON_CLASS} />}
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
      <TrashIcon className={ROW_ACTION_ICON_CLASS} />
    </CommandButton>
  );
}
