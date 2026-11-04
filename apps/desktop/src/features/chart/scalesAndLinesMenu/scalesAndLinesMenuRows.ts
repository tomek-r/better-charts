import type { KeyboardEvent } from 'react';

/** The class every row of the menu has, in the menu itself and in the submenu a row opens. */
export const MENU_ROW_CLASS = 'scales-and-lines-menu-row';

/** The class of the submenu a row opens, which hangs beside the menu's own rows. */
export const MENU_SUBMENU_CLASS = 'scales-and-lines-menu-submenu';

/** The submenus the menu's rows open. */
export type SubmenuName = 'labels' | 'lines';

/** How a submenu was opened: the pointer's hover leaves the focus be, the row's activation moves into it. */
export type SubmenuOpening = 'hover' | 'activate';

/** The rows one level of the menu draws itself: a submenu's rows belong to the submenu, not to the menu. */
export function menuRows(level: HTMLElement | null): HTMLButtonElement[] {
  if (level === null) {
    return [];
  }
  return Array.from(level.querySelectorAll<HTMLButtonElement>(`:scope > .${MENU_ROW_CLASS}:not(:disabled)`));
}

/** Moves the focus one row down (`1`) or up (`-1`) from `focused`, wrapping around the level's ends. */
export function focusSiblingRow(level: HTMLElement | null, focused: EventTarget | null, step: 1 | -1): void {
  const rows = menuRows(level);
  const index = rows.findIndex((row) => row === focused);
  if (index < 0) {
    rows.at(0)?.focus();
    return;
  }
  rows.at((index + step + rows.length) % rows.length)?.focus();
}

/** Focuses the first or the last row of the level, as Home and End ask. */
export function focusEndRow(level: HTMLElement | null, end: 'first' | 'last'): void {
  menuRows(level)
    .at(end === 'first' ? 0 : -1)
    ?.focus();
}

/** Whether the row opens a submenu, which the row announces with the popup it carries. */
export function carriesSubmenu(row: Element): boolean {
  return row.getAttribute('aria-haspopup') === 'menu';
}

/**
 * The menu's own row under the pointer, and none under a row of the submenu: those rows are not the menu's, so
 * the pointer over them leaves the submenu that holds them open.
 */
export function menuRowUnder(pointerTarget: EventTarget | null): HTMLButtonElement | undefined {
  if (!(pointerTarget instanceof Element) || pointerTarget.closest(`.${MENU_SUBMENU_CLASS}`) !== null) {
    return undefined;
  }
  const row = pointerTarget.closest(`.${MENU_ROW_CLASS}`);
  return row instanceof HTMLButtonElement ? row : undefined;
}

/** Whether the focus sits in the menu's open submenu, which hands it back to its row as that submenu closes. */
export function submenuHoldsFocus(): boolean {
  const focused = document.activeElement;
  return focused instanceof Element && focused.closest(`.${MENU_SUBMENU_CLASS}`) !== null;
}

/** Right on a row opens the submenu it carries, the same way a press on the row does; other rows carry none. */
function openCarriedSubmenu(row: EventTarget | null): void {
  if (row instanceof HTMLElement && carriesSubmenu(row)) {
    row.click();
  }
}

/** Runs the key the menu answers to; every other key is left to the rows themselves and to the page. */
export function handleMenuKey(
  event: KeyboardEvent<HTMLDivElement>,
  menu: HTMLElement | null,
  onClose: () => void,
): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    focusSiblingRow(menu, event.target, event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Home' || event.key === 'End') {
    focusEndRow(menu, event.key === 'Home' ? 'first' : 'last');
  } else if (event.key === 'ArrowRight') {
    openCarriedSubmenu(event.target);
  } else if (event.key === 'Escape') {
    onClose();
  } else {
    return;
  }
  event.preventDefault();
}
