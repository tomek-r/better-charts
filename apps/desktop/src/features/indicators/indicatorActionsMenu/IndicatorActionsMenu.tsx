import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { CaretIcon } from '../../../shared/ui/icons/CaretIcon';
import { focusFirstRow, handleMenuKey } from '../../../shared/ui/popup/popupMenuKeys';
import { usePopupPlacement } from '../../../shared/ui/popup/usePopupPlacement';
import {
  INDICATOR_ACTION_LABELS,
  INDICATOR_ACTIONS_MENU_LABEL,
  OWN_PANE_VISUAL_ORDER_TITLE,
} from './indicatorActionsMenuLabels';
import type { VisualOrderTargets } from './indicatorVisualOrder';

/** The class of every row of the menu and of its submenu: the popup menus' row paint, with the menu's own layout. */
const MENU_ROW_CLASS = 'popup-menu-row indicator-actions-menu-row';

/** The arrow of the row that opens the paint-order submenu, turned to point at the submenu beside it. */
const CARET_CLASS = 'indicator-actions-menu-caret';

const SEPARATOR = <div role="separator" className="chart-context-menu-separator" />;

interface MenuRowProps {
  readonly label: string;
  readonly onSelect: () => void;
}

/** One command row of the menu. */
function MenuRow({ label, onSelect }: MenuRowProps) {
  return (
    <button type="button" role="menuitem" className={MENU_ROW_CLASS} onClick={onSelect}>
      <span className="chart-context-menu-label">{label}</span>
    </button>
  );
}

interface VisualOrderSubmenuRowProps {
  readonly rowRef: RefObject<HTMLButtonElement | null>;
  readonly expanded: boolean;
  readonly onOpen: () => void;
}

/** The row that opens the paint-order submenu. */
function VisualOrderSubmenuRow({ rowRef, expanded, onOpen }: VisualOrderSubmenuRowProps) {
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
      <span className="chart-context-menu-label">{INDICATOR_ACTION_LABELS.visualOrder}</span>
      <CaretIcon className={CARET_CLASS} />
    </button>
  );
}

/** The paint-order row of an indicator whose own pane has a place of its own, so there is no order to move in. */
function VisualOrderUnavailableRow() {
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled="true"
      title={OWN_PANE_VISUAL_ORDER_TITLE}
      className={MENU_ROW_CLASS}
    >
      <span className="chart-context-menu-label">{INDICATOR_ACTION_LABELS.visualOrder}</span>
      <CaretIcon className={CARET_CLASS} />
    </button>
  );
}

interface VisualOrderSubmenuProps {
  /** The row that opened the submenu: the submenu is placed against it and gives it the focus back. */
  readonly anchorRow: RefObject<HTMLButtonElement | null>;
  readonly onBringToFront: () => void;
  readonly onSendToBack: () => void;
  readonly onClose: () => void;
}

/** The paint-order commands, as their own menu hung under the row that opens them. */
function VisualOrderSubmenu({ anchorRow, onBringToFront, onSendToBack, onClose }: VisualOrderSubmenuProps) {
  const submenuRef = useRef<HTMLDivElement>(null);
  usePopupPlacement(anchorRow, submenuRef);

  useEffect(() => {
    focusFirstRow(submenuRef.current);
  }, []);

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

  return (
    <div
      ref={submenuRef}
      className="popup-surface indicator-actions-menu"
      role="menu"
      aria-label={INDICATOR_ACTION_LABELS.visualOrder}
      onKeyDown={onKeyDown}
    >
      <MenuRow label={INDICATOR_ACTION_LABELS.bringToFront} onSelect={onBringToFront} />
      <MenuRow label={INDICATOR_ACTION_LABELS.sendToBack} onSelect={onSendToBack} />
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
  readonly onBringToFront: () => void;
  readonly onSendToBack: () => void;
  readonly onOpenVisibility: () => void;
  readonly onSetHidden: () => void;
  readonly onRemove: () => void;
  readonly onOpenSettings: () => void;
  /** Closes the menu and gives the focus back to the button or the row that opened it. */
  readonly onClose: () => void;
}

/**
 * The actions menu of one indicator: the paint order of a price-pane one, the way to its Visibility tab, hiding or
 * showing it, removing it and its settings. Its rows are the popup menus' own, so it reads as the time zone and
 * timeframe pickers do; the paint order hangs as a submenu from the row that opens it.
 */
export function IndicatorActionsMenu(props: IndicatorActionsMenuProps) {
  const {
    menuRef,
    hidden,
    visualOrder,
    onBringToFront,
    onSendToBack,
    onOpenVisibility,
    onSetHidden,
    onRemove,
    onOpenSettings,
    onClose,
  } = props;
  const visualOrderRowRef = useRef<HTMLButtonElement>(null);
  const [visualOrderOpen, setVisualOrderOpen] = useState(false);

  // The first row takes the focus as the menu opens, so the arrow keys walk it straight away.
  useEffect(() => {
    focusFirstRow(menuRef.current);
  }, [menuRef]);

  const closeVisualOrder = () => {
    setVisualOrderOpen(false);
    visualOrderRowRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const visualOrderRowFocused = document.activeElement === visualOrderRowRef.current;
    if (event.key === 'ArrowRight' && visualOrderRowFocused && visualOrder !== undefined) {
      event.preventDefault();
      setVisualOrderOpen(true);
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
    >
      {visualOrder === undefined ? (
        <VisualOrderUnavailableRow />
      ) : (
        <VisualOrderSubmenuRow
          rowRef={visualOrderRowRef}
          expanded={visualOrderOpen}
          onOpen={() => setVisualOrderOpen(true)}
        />
      )}
      {SEPARATOR}
      <MenuRow label={INDICATOR_ACTION_LABELS.visibilityOnIntervals} onSelect={onOpenVisibility} />
      <MenuRow label={hidden ? INDICATOR_ACTION_LABELS.show : INDICATOR_ACTION_LABELS.hide} onSelect={onSetHidden} />
      <MenuRow label={INDICATOR_ACTION_LABELS.remove} onSelect={onRemove} />
      {SEPARATOR}
      <MenuRow label={INDICATOR_ACTION_LABELS.settings} onSelect={onOpenSettings} />
      {visualOrderOpen && visualOrder !== undefined && (
        <VisualOrderSubmenu
          anchorRow={visualOrderRowRef}
          onBringToFront={onBringToFront}
          onSendToBack={onSendToBack}
          onClose={closeVisualOrder}
        />
      )}
    </div>
  );
}
