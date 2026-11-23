import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { CaretIcon } from '../../../shared/ui/icons/CaretIcon';
import { EyeCrossedIcon, EyeIcon, TrashIcon } from '../../../shared/ui/icons/drawingActionIcons';
import { SettingsIcon } from '../../../shared/ui/icons/SettingsIcon';
import { focusFirstRow, handleMenuKey } from '../../../shared/ui/popup/popupMenuKeys';
import { usePopupPlacement } from '../../../shared/ui/popup/usePopupPlacement';
import { LayersIcon } from '../../side-drawers/sideDrawerIcons';
import {
  INDICATOR_ACTION_LABELS,
  INDICATOR_ACTIONS_MENU_LABEL,
  OWN_PANE_VISUAL_ORDER_TITLE,
  REMOVE_SHORTCUT_HINT,
} from './indicatorActionsMenuLabels';
import type { VisualOrderTargets } from './indicatorVisualOrder';

/** The class of every row of the menu and of its submenu: the popup menus' row paint, with the menu's own layout. */
const MENU_ROW_CLASS = 'popup-menu-row indicator-actions-menu-row';

/** The column every row of the menu opens with, so a row without a command glyph keeps its words in line. */
const ICON_SLOT_CLASS = 'indicator-actions-menu-icon';

/** The glyph of a command row, drawn at the size of the legend's own row buttons. */
const GLYPH_CLASS = 'indicator-actions-menu-glyph';

/** The arrow of the row that opens the paint-order submenu, turned to point at the submenu beside it. */
const CARET_CLASS = 'indicator-actions-menu-caret';

const SEPARATOR = <div role="separator" className="chart-context-menu-separator" />;

interface MenuRowProps {
  readonly label: string;
  /** The command's glyph; a row whose words say it all leaves the column empty. */
  readonly icon?: ReactNode;
  /** The key that does the same thing, named at the row's far end. */
  readonly shortcut?: string;
  readonly onSelect: () => void;
}

/** One command row of the menu. */
function MenuRow({ label, icon, shortcut, onSelect }: MenuRowProps) {
  return (
    <button type="button" role="menuitem" className={MENU_ROW_CLASS} onClick={onSelect}>
      <span className={ICON_SLOT_CLASS}>{icon}</span>
      <span className="chart-context-menu-label">{label}</span>
      {shortcut !== undefined && <kbd className="chart-context-menu-shortcut">{shortcut}</kbd>}
    </button>
  );
}

interface HideMenuRowProps {
  /** Whether the indicator is hidden, which words the row "Show" with the plain eye. */
  readonly hidden: boolean;
  readonly onToggle: () => void;
}

/** The row that hides the indicator, or shows it again: the eye it draws is crossed out while it is shown. */
function HideMenuRow({ hidden, onToggle }: HideMenuRowProps) {
  return (
    <MenuRow
      label={hidden ? INDICATOR_ACTION_LABELS.show : INDICATOR_ACTION_LABELS.hide}
      icon={hidden ? <EyeIcon className={GLYPH_CLASS} /> : <EyeCrossedIcon className={GLYPH_CLASS} />}
      onSelect={onToggle}
    />
  );
}

interface VisualOrderRowProps {
  readonly rowRef: RefObject<HTMLButtonElement | null>;
  readonly expanded: boolean;
  readonly onOpen: () => void;
}

/**
 * The row that opens the paint-order submenu. It answers even when none of the submenu's commands can apply, as
 * it does for an indicator with a pane of its own: the submenu then says so, row by row.
 */
function VisualOrderRow({ rowRef, expanded, onOpen }: VisualOrderRowProps) {
  return (
    <button
      ref={rowRef}
      type="button"
      role="menuitem"
      aria-haspopup="menu"
      aria-expanded={expanded}
      className={MENU_ROW_CLASS}
      onClick={onOpen}
    >
      <span className={ICON_SLOT_CLASS}>
        <LayersIcon className={GLYPH_CLASS} />
      </span>
      <span className="chart-context-menu-label">{INDICATOR_ACTION_LABELS.visualOrder}</span>
      <CaretIcon className={CARET_CLASS} />
    </button>
  );
}

interface VisualOrderCommandRowProps {
  readonly label: string;
  /** The row the command moves the indicator to; undefined while the command cannot change the order. */
  readonly targetInstanceId: string | undefined;
  /** Why the command cannot apply, for an indicator the price pane's paint order does not hold. */
  readonly unavailableTitle: string | undefined;
  readonly onMove: (targetInstanceId: string) => void;
}

/** One paint-order command: it greys out, and does nothing, while it cannot change the order. */
function VisualOrderCommandRow(props: VisualOrderCommandRowProps) {
  const { label, targetInstanceId, unavailableTitle, onMove } = props;
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={targetInstanceId === undefined}
      title={targetInstanceId === undefined ? unavailableTitle : undefined}
      className={MENU_ROW_CLASS}
      onClick={() => {
        if (targetInstanceId !== undefined) {
          onMove(targetInstanceId);
        }
      }}
    >
      <span className="chart-context-menu-label">{label}</span>
    </button>
  );
}

/** One paint-order command, with the target of the move it makes. */
interface VisualOrderCommandSpec {
  readonly label: string;
  readonly targetKey: keyof VisualOrderTargets;
}

/** The paint-order commands, in the order the submenu draws them. */
const VISUAL_ORDER_COMMANDS: readonly VisualOrderCommandSpec[] = [
  { label: INDICATOR_ACTION_LABELS.bringToFront, targetKey: 'frontInstanceId' },
  { label: INDICATOR_ACTION_LABELS.sendToBack, targetKey: 'backInstanceId' },
  { label: INDICATOR_ACTION_LABELS.bringForward, targetKey: 'forwardInstanceId' },
  { label: INDICATOR_ACTION_LABELS.sendBackward, targetKey: 'backwardInstanceId' },
];

/**
 * How the paint-order submenu is open: not at all, under the pointer (which leaves the focus on the menu), or by a
 * press or the keys (which hand the focus to its first row).
 */
type VisualOrderOpening = 'closed' | 'pointer' | 'focus';

interface VisualOrderSubmenuProps {
  /** The row that opened the submenu: the submenu's first row lines up with it, and it takes the focus back. */
  readonly anchorRow: RefObject<HTMLButtonElement | null>;
  /** The menu the submenu hangs beside, clear of its right edge. */
  readonly menu: RefObject<HTMLDivElement | null>;
  /** Whether the submenu takes the focus as it opens, as a press or the keys ask and a hover does not. */
  readonly takeFocus: boolean;
  /** Where the commands move the indicator; undefined for one the price pane's paint order does not hold. */
  readonly targets: VisualOrderTargets | undefined;
  readonly onMove: (targetInstanceId: string) => void;
  readonly onClose: () => void;
}

/** The paint-order commands, as their own menu hung beside the menu, level with the row that opens them. */
function VisualOrderSubmenu({ anchorRow, menu, takeFocus, targets, onMove, onClose }: VisualOrderSubmenuProps) {
  const submenuRef = useRef<HTMLDivElement>(null);
  usePopupPlacement(anchorRow, submenuRef, { besideRef: menu });

  useEffect(() => {
    if (takeFocus) {
      focusFirstRow(submenuRef.current);
    }
  }, [takeFocus]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    // The keys walk the submenu alone, never the menu it hangs under.
    event.stopPropagation();
    handleMenuKey(event, submenuRef.current, onClose);
  };

  const unavailableTitle = targets === undefined ? OWN_PANE_VISUAL_ORDER_TITLE : undefined;

  return (
    <div
      ref={submenuRef}
      className="popup-surface indicator-actions-menu"
      role="menu"
      aria-label={INDICATOR_ACTION_LABELS.visualOrder}
      onKeyDown={onKeyDown}
    >
      {VISUAL_ORDER_COMMANDS.map(({ label, targetKey }) => (
        <VisualOrderCommandRow
          key={label}
          label={label}
          targetInstanceId={targets?.[targetKey]}
          unavailableTitle={unavailableTitle}
          onMove={onMove}
        />
      ))}
    </div>
  );
}

export interface IndicatorActionsMenuProps {
  /** The menu's own element, which the popup places against the point that opened it. */
  readonly menuRef: RefObject<HTMLDivElement | null>;
  /** Whether the indicator is hidden, which words its toggle "Show" instead of "Hide". */
  readonly hidden: boolean;
  /** Where the paint-order rows move the indicator; undefined for one with a pane of its own. */
  readonly visualOrder: VisualOrderTargets | undefined;
  /** Moves the indicator to the row the picked paint-order command names. */
  readonly onMoveInVisualOrder: (targetInstanceId: string) => void;
  readonly onOpenVisibility: () => void;
  readonly onSetHidden: () => void;
  readonly onRemove: () => void;
  /**
   * Opens the Object tree drawer, which only a legend row's menu offers: the tree's own rows already sit there.
   */
  readonly onOpenObjectTree?: () => void;
  readonly onOpenSettings: () => void;
  /** Closes the menu and gives the focus back to the button or the row that opened it. */
  readonly onClose: () => void;
}

/**
 * The actions menu of one indicator: the paint order of a price-pane one, the way to its Visibility tab, hiding or
 * showing it, removing it, the way to the Object tree and its settings. Its rows are the popup menus' own, so it
 * reads as the time zone and timeframe pickers do; the paint order hangs as a submenu from the row that opens it.
 */
export function IndicatorActionsMenu(props: IndicatorActionsMenuProps) {
  const {
    menuRef,
    hidden,
    visualOrder,
    onMoveInVisualOrder,
    onOpenVisibility,
    onSetHidden,
    onRemove,
    onOpenObjectTree,
    onOpenSettings,
    onClose,
  } = props;
  const visualOrderRowRef = useRef<HTMLButtonElement>(null);
  const [visualOrderOpening, setVisualOrderOpening] = useState<VisualOrderOpening>('closed');

  // The first row takes the focus as the menu opens, so the arrow keys walk it straight away.
  useEffect(() => {
    focusFirstRow(menuRef.current);
  }, [menuRef]);

  const closeVisualOrder = () => {
    setVisualOrderOpening('closed');
    visualOrderRowRef.current?.focus();
  };

  // The pointer opens the submenu on its row and closes it on any other row of this menu; the submenu's own rows
  // sit inside another menu, so moving over them keeps it open.
  const onPointerOver = (event: PointerEvent<HTMLDivElement>) => {
    const row = event.target instanceof Element ? event.target.closest('[role="menuitem"]') : null;
    if (row === null || row.closest('[role="menu"]') !== menuRef.current) {
      return;
    }
    if (row === visualOrderRowRef.current) {
      setVisualOrderOpening((current) => (current === 'closed' ? 'pointer' : current));
      return;
    }
    setVisualOrderOpening('closed');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const visualOrderRowFocused = document.activeElement === visualOrderRowRef.current;
    if (event.key === 'ArrowRight' && visualOrderRowFocused) {
      event.preventDefault();
      setVisualOrderOpening('focus');
      return;
    }
    handleMenuKey(event, menuRef.current, onClose);
  };

  return (
    <div
      ref={menuRef}
      className="popup-surface indicator-actions-menu"
      role="menu"
      aria-label={INDICATOR_ACTIONS_MENU_LABEL}
      onKeyDown={onKeyDown}
      onPointerOver={onPointerOver}
    >
      <VisualOrderRow
        rowRef={visualOrderRowRef}
        expanded={visualOrderOpening !== 'closed'}
        onOpen={() => setVisualOrderOpening('focus')}
      />
      {SEPARATOR}
      <MenuRow label={INDICATOR_ACTION_LABELS.visibilityOnIntervals} onSelect={onOpenVisibility} />
      <HideMenuRow hidden={hidden} onToggle={onSetHidden} />
      <MenuRow
        label={INDICATOR_ACTION_LABELS.remove}
        icon={<TrashIcon className={GLYPH_CLASS} />}
        shortcut={REMOVE_SHORTCUT_HINT}
        onSelect={onRemove}
      />
      {SEPARATOR}
      {onOpenObjectTree !== undefined && (
        <>
          <MenuRow label={INDICATOR_ACTION_LABELS.objectTree} onSelect={onOpenObjectTree} />
          {SEPARATOR}
        </>
      )}
      <MenuRow
        label={INDICATOR_ACTION_LABELS.settings}
        icon={<SettingsIcon className={GLYPH_CLASS} />}
        onSelect={onOpenSettings}
      />
      {visualOrderOpening !== 'closed' && (
        <VisualOrderSubmenu
          anchorRow={visualOrderRowRef}
          menu={menuRef}
          takeFocus={visualOrderOpening === 'focus'}
          targets={visualOrder}
          onMove={onMoveInVisualOrder}
          onClose={closeVisualOrder}
        />
      )}
    </div>
  );
}
