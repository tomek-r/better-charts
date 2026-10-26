import type { KeyboardEvent } from 'react';

/** The class of a row's name button, which the arrow keys and the focus after a removal walk by. */
export const ROW_NAME_CLASS = 'object-tree-row-name';

const ROW_NAME_SELECTOR = `.${ROW_NAME_CLASS}`;

/** Arrow keys walk the rows in list order: down the tree and up it, stopping at its ends. */
const ROW_FOCUS_STEPS: Readonly<Partial<Record<string, number>>> = { ArrowDown: 1, ArrowUp: -1 };

/** Every name button of a list, topmost first. */
export function rowNameButtons(list: HTMLElement | null): HTMLButtonElement[] {
  return list === null ? [] : [...list.querySelectorAll<HTMLButtonElement>(ROW_NAME_SELECTOR)];
}

/** Focuses the name button of the row that holds the given layer index, when the list has that row. */
export function focusLayerNameAt(list: HTMLElement, layerIndex: number): void {
  list.querySelector<HTMLButtonElement>(`[data-layer-index="${layerIndex}"] ${ROW_NAME_SELECTOR}`)?.focus();
}

/** Moves focus one row down or up the list the pressed button lives in; the ends hold focus. */
export function walkRowFocus(event: KeyboardEvent<HTMLButtonElement>): void {
  const step = ROW_FOCUS_STEPS[event.key];
  if (step === undefined) {
    return;
  }
  event.preventDefault();
  const rowButtons = rowNameButtons(event.currentTarget.closest('ul'));
  rowButtons[rowButtons.indexOf(event.currentTarget) + step]?.focus();
}
