import type { DevTestApi } from '../../src/features/chart/engine/devTestApi';

/**
 * The DEV-only chart hook, declared once from its own source of truth.
 *
 * Specs used to restate the members they called, and three of them restated
 * `timeToX` as returning `number | null` while the implementation returns `NaN`
 * for "no coordinate" — a claim nothing could catch, because `e2e/` sat outside
 * the typecheck program. Typing `window.__chartTest` here keeps one definition
 * and, now that the program includes this directory, turns any divergence into a
 * typecheck failure.
 *
 * This file is in `e2e/`, so production code cannot see the augmentation: `src`
 * never touches `window.__chartTest` outside devTestApi's own installer.
 */
declare global {
  interface Window {
    __chartTest?: DevTestApi;
  }
}
