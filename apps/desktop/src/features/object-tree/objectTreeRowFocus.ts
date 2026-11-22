import type { KeyboardEvent } from 'react';
import { arrowStep, type ArrowSteps } from '../../shared/ui/keyboard/arrowStep';

/** The class of a row's name button, which the arrow keys and the focus after a removal walk by. */
export const ROW_NAME_CLASS = 'object-tree-row-name';

const ROW_NAME_SELECTOR = `.${ROW_NAME_CLASS}`;

/** Arrow keys walk the rows in list order: down the tree and up it, stopping at its ends. */
const ROW_FOCUS_STEPS: ArrowSteps = { ArrowDown: 1, ArrowUp: -1 };

/** Every name button of a list, topmost first. */
export function rowNameButtons(list: HTMLElement | null): HTMLButtonElement[] {
  return list === null ? [] : [...list.querySelectorAll<HTMLButtonElement>(ROW_NAME_SELECTOR)];
}

/** Focuses the name button of the row that holds the given index, when the list has that row. */
export function focusRowNameAt(list: HTMLElement, rowIndex: number): void {
  list.querySelector<HTMLButtonElement>(`[data-row-index="${rowIndex}"] ${ROW_NAME_SELECTOR}`)?.focus();
}

/** Moves focus one row down or up the list the pressed button lives in; the ends hold focus. */
export function walkRowFocus(event: KeyboardEvent<HTMLButtonElement>): void {
  const step = arrowStep(event.key, ROW_FOCUS_STEPS);
  if (step === undefined) {
    return;
  }
  event.preventDefault();
  const rowButtons = rowNameButtons(event.currentTarget.closest('ul'));
  rowButtons[rowButtons.indexOf(event.currentTarget) + step]?.focus();
}
