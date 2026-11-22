import { arrowStep, type ArrowSteps } from '../keyboard/arrowStep';
import type { SelectOption } from './selectOption';

/** How far an arrow key moves the highlight; every other key does not move it. */
const ARROW_STEPS: ArrowSteps = { ArrowDown: 1, ArrowUp: -1 };

/** Whether a choice is closed to the user yet, so the list steps over it. */
function isClosed(option: SelectOption): boolean {
  return option.disabled === true;
}

/** The first choice a user can pick; undefined when every choice is closed. */
function firstOpenIndex(options: readonly SelectOption[]): number | undefined {
  const index = options.findIndex((option) => !isClosed(option));
  return index < 0 ? undefined : index;
}

/** The last choice a user can pick; undefined when every choice is closed. */
function lastOpenIndex(options: readonly SelectOption[]): number | undefined {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!isClosed(options[index])) {
      return index;
    }
  }
  return undefined;
}

/** The nearest open choice `step` places on, within the ends; undefined when there is none that way. */
function openIndexOf(options: readonly SelectOption[], from: number, step: number): number | undefined {
  for (let index = from + step; index >= 0 && index < options.length; index += step) {
    if (!isClosed(options[index])) {
      return index;
    }
  }
  return undefined;
}

/**
 * The choice an arrow, Home or End key moves the highlight to; undefined for any other key. A closed
 * choice is stepped over, and the ends do not wrap.
 */
export function movedOptionIndex(
  key: string,
  activeIndex: number,
  options: readonly SelectOption[],
): number | undefined {
  if (key === 'Home') {
    return firstOpenIndex(options);
  }
  if (key === 'End') {
    return lastOpenIndex(options);
  }
  const step = arrowStep(key, ARROW_STEPS);
  return step === undefined ? undefined : openIndexOf(options, activeIndex, step);
}

/**
 * The next choice whose label starts with the typed character, searching after the highlighted one and
 * wrapping round to it; undefined when no open label starts with it.
 */
export function typedOptionIndex(
  character: string,
  activeIndex: number,
  options: readonly SelectOption[],
): number | undefined {
  const wanted = character.toLowerCase();
  for (let step = 1; step <= options.length; step += 1) {
    const index = (activeIndex + step) % options.length;
    const option = options[index];
    if (!isClosed(option) && option.label.toLowerCase().startsWith(wanted)) {
      return index;
    }
  }
  return undefined;
}

/** The choice the list highlights when it opens: the chosen one, or the first a user can pick. */
export function initialOptionIndex(options: readonly SelectOption[], value: string): number {
  const chosen = options.findIndex((option) => option.value === value);
  return chosen < 0 ? (firstOpenIndex(options) ?? 0) : chosen;
}
