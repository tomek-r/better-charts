import { useRef, useState, type KeyboardEvent, type RefObject } from 'react';

/** The rows of the menu the keys walk, in the order it draws them. */
const ROW_SELECTOR = '[role="menuitemradio"]';

/** The menu's rows, in the order they are drawn. */
function menuRows(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu === null ? [] : Array.from(menu.querySelectorAll<HTMLButtonElement>(ROW_SELECTOR));
}

/** Which row a key moves the focus to: the one beside the focused row, or the menu's first or last. */
type RowTarget = 'next' | 'previous' | 'first' | 'last';

/** The row each key the menu answers to moves the focus to. */
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

/** Takes the focus as the menu opens: the bar type the chart draws, so the keys walk on from there. */
export function focusCheckedRow(menu: HTMLElement | null): void {
  menu?.querySelector<HTMLButtonElement>(`${ROW_SELECTOR}[aria-checked="true"]`)?.focus();
}

/** Runs the key the menu answers to; Enter and Space are the rows' own, and every other key is the page's. */
export function handleMenuKey(
  event: KeyboardEvent<HTMLDivElement>,
  menu: HTMLElement | null,
  onClose: () => void,
): void {
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

/** The menu's open state, the trigger it hangs from, and the ways it closes. */
export interface BarStyleMenuState {
  readonly open: boolean;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  /** Opens the menu, or closes it and hands the focus back to the trigger. */
  toggle(): void;
  /** Closes the menu and hands the focus back to the trigger, as Escape and a chosen row ask. */
  close(): void;
  /** Closes the menu for a press elsewhere on the page, which leaves the focus where the press put it. */
  dismiss(): void;
}

/** The bar type menu's open state, with the trigger every close hands the focus back to. */
export function useBarStyleMenu(): BarStyleMenuState {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  return {
    open,
    triggerRef,
    toggle: () => setOpen((current) => !current),
    close,
    dismiss: () => setOpen(false),
  };
}
