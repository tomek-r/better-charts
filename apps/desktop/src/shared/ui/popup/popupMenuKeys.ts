import type { KeyboardEvent } from 'react';

/** The rows of a menu the keys walk, in the order it draws them: its radio and checkbox items. */
const ROW_SELECTOR = '[role="menuitemradio"], [role="menuitemcheckbox"]';

/** The row a menu opens on: the radio it has checked, never a switch row, which names no choice. */
const CHECKED_ROW_SELECTOR = '[role="menuitemradio"][aria-checked="true"]';

/** The menu's rows, in the order they are drawn. */
function menuRows(menu: HTMLElement | null): HTMLElement[] {
  return menu === null ? [] : Array.from(menu.querySelectorAll<HTMLElement>(ROW_SELECTOR));
}

/** Which row a key moves the focus to: the one beside the focused row, or the menu's first or last. */
type RowTarget = 'next' | 'previous' | 'first' | 'last';

/** The row each key a menu answers to moves the focus to. */
const KEY_TARGETS = new Map<string, RowTarget>([
  ['ArrowDown', 'next'],
  ['ArrowUp', 'previous'],
  ['Home', 'first'],
  ['End', 'last'],
]);

/** Focuses one row of the menu: its first or its last, or the one beside the focused row, wrapping at the ends. */
function focusRow(menu: HTMLElement | null, target: RowTarget): void {
  const rows = menuRows(menu);
  if (rows.length === 0) {
    return;
  }
  if (target === 'first' || target === 'last') {
    rows.at(target === 'first' ? 0 : -1)?.focus();
    return;
  }
  const step = target === 'next' ? 1 : -1;
  const focused = rows.findIndex((row) => row === document.activeElement);
  rows.at(focused < 0 ? 0 : (focused + step + rows.length) % rows.length)?.focus();
}

/** Takes the focus as a menu opens, on the row it has chosen, so the keys walk on from there. */
export function focusCheckedRow(menu: HTMLElement | null): void {
  menu?.querySelector<HTMLElement>(CHECKED_ROW_SELECTOR)?.focus();
}

/** Runs the key the menu answers to; Enter and Space are the rows' own, and every other key is the page's. */
export function handleMenuKey(event: KeyboardEvent<HTMLElement>, menu: HTMLElement | null, onClose: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    onClose();
    return;
  }
  const target = KEY_TARGETS.get(event.key);
  if (target === undefined) {
    return;
  }
  event.preventDefault();
  focusRow(menu, target);
}
