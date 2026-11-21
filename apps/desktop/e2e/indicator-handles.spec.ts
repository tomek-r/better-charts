import { expect, test } from '@playwright/test';
import { handleBarIndices } from '../src/features/chart/engine/indicators/indicatorHandleIndices';
import { handleRadius, handleRingWidth } from '../src/features/chart/engine/indicators/indicatorHandles';

/**
 * Where a selected indicator's plots put their handle dots: one every 10th bar of the pane plus the bar
 * the plot ends on, and the size a dot and the ring around it are drawn at on any pixel ratio.
 */

test('a handle sits on every tenth bar of the pane, counted from its first visible one', () => {
  expect(handleBarIndices({ from: 0, to: 25 }, null)).toEqual([0, 10, 20]);
  expect(handleBarIndices({ from: 3.4, to: 27 }, null)).toEqual([4, 14, 24]);
});

test('the empty space left of the data carries no handle', () => {
  expect(handleBarIndices({ from: -2, to: 9 }, null)).toEqual([0]);
});

test('the bar the plot ends on carries one, added once when it falls on an interval bar', () => {
  expect(handleBarIndices({ from: 0, to: 25 }, 25)).toEqual([0, 10, 20, 25]);
  expect(handleBarIndices({ from: 0, to: 25 }, 20)).toEqual([0, 10, 20]);
});

test('a last bar outside the pane adds no handle', () => {
  expect(handleBarIndices({ from: 0, to: 25 }, 40)).toEqual([0, 10, 20]);
});

test('a pane of empty space right of the newest bar carries no handle', () => {
  expect(handleBarIndices({ from: 12, to: 9 }, 9)).toEqual([]);
});

test('a dot and its ring stay 4 and 1 CSS pixels on any pixel ratio', () => {
  expect(handleRadius(1)).toBe(4);
  expect(handleRadius(2)).toBe(8);
  expect(handleRingWidth(1)).toBe(1);
  expect(handleRingWidth(2)).toBe(2);
});
