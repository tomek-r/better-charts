import type { ReactNode } from 'react';
import { CaretIcon } from '../../../shared/ui/icons/CaretIcon';
import { CheckIcon } from '../../../shared/ui/icons/CheckIcon';
import { MENU_ROW_CLASS, type SubmenuName } from './scalesAndLinesMenuRows';

/** What a row does when it is picked: run a command, hold a value, pick one of a pair, or open a submenu. */
const ROW_ROLES = {
  command: 'menuitem',
  checkbox: 'menuitemcheckbox',
  radio: 'menuitemradio',
  submenu: 'menuitem',
} as const;

interface RowInteraction {
  readonly label: string;
  /** Runs the row; the row itself comes along, for the rows that hang a submenu from themselves. */
  readonly onActivate: (row: HTMLButtonElement) => void;
  /** Opens the row's submenu as the pointer arrives on it. */
  readonly onHover?: (row: HTMLButtonElement) => void;
}

/** A row that runs something at once, such as the reset of the scale or the dialog's settings. */
interface CommandRow extends RowInteraction {
  readonly kind: 'command';
  readonly icon: ReactNode;
  readonly shortcut?: string;
}

/** A row that holds a value: a box of its own, or one of the pair of the scale's price spacing. */
interface ToggleRow extends RowInteraction {
  readonly kind: 'checkbox' | 'radio';
  readonly checked: boolean;
  readonly shortcut?: string;
}

/** A row that opens a submenu beside the menu. */
interface SubmenuRow extends RowInteraction {
  readonly kind: 'submenu';
  readonly name: SubmenuName;
  readonly expanded: boolean;
}

export type ScalesAndLinesMenuRowProps = CommandRow | ToggleRow | SubmenuRow;

/** The tick of a row holding a value, or the mark of a command row, in the one column both start with. */
function leadingMark(props: ScalesAndLinesMenuRowProps): ReactNode {
  if ('checked' in props) {
    return props.checked ? <CheckIcon className="scales-and-lines-menu-check" /> : null;
  }
  if ('icon' in props) {
    return props.icon;
  }
  return null;
}

/**
 * One row of the Scales and lines menu: its check column, its label, the shortcut that does the same from the
 * keyboard, and the arrow of a row that opens a submenu. The paint is the right-click menu's own.
 */
export function ScalesAndLinesMenuRow(props: ScalesAndLinesMenuRowProps) {
  const { kind, label, onActivate, onHover } = props;
  const shortcut = 'shortcut' in props ? props.shortcut : undefined;
  return (
    <button
      type="button"
      role={ROW_ROLES[kind]}
      aria-checked={'checked' in props ? props.checked : undefined}
      aria-haspopup={props.kind === 'submenu' ? 'menu' : undefined}
      aria-expanded={props.kind === 'submenu' ? props.expanded : undefined}
      className={`ticket-menu-item ${MENU_ROW_CLASS}`}
      onClick={(event) => onActivate(event.currentTarget)}
      onPointerEnter={(event) => onHover?.(event.currentTarget)}
    >
      <span className="scales-and-lines-menu-leading" aria-hidden="true">
        {leadingMark(props)}
      </span>
      <span className="chart-context-menu-label">{label}</span>
      {shortcut !== undefined && <kbd className="chart-context-menu-shortcut">{shortcut}</kbd>}
      {props.kind === 'submenu' && <CaretIcon className="scales-and-lines-menu-caret" />}
    </button>
  );
}
