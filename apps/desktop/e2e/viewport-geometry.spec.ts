import { test, expect } from '@playwright/test';
import { isOutsidePane } from '../src/features/chart/engine/viewportController';

/** Pure pane-bounds predicate behind the Cross tool's hide-rather-than-clamp rule. */

test('accepts a pointer inside the pane, including its edges', () => {
  expect(isOutsidePane(0, 0, 800, 600)).toBe(false);
  expect(isOutsidePane(400, 300, 800, 600)).toBe(false);
  expect(isOutsidePane(800, 600, 800, 600)).toBe(false);
});

test('rejects a pointer past each side of the pane', () => {
  expect(isOutsidePane(-1, 300, 800, 600)).toBe(true);
  expect(isOutsidePane(400, -1, 800, 600)).toBe(true);
  expect(isOutsidePane(801, 300, 800, 600)).toBe(true);
  expect(isOutsidePane(400, 601, 800, 600)).toBe(true);
});

test('keeps a non-finite coordinate on the pointer path', () => {
  // The inverted form (x >= 0 && y >= 0 && ...) would hide the crosshair for a
  // non-finite coordinate. The raw bounds test keeps moving it, which is what
  // the chart did before the viewport move.
  expect(isOutsidePane(Number.NaN, 300, 800, 600)).toBe(false);
  expect(isOutsidePane(400, Number.NaN, 800, 600)).toBe(false);
});
