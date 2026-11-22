import { expect, test } from '@playwright/test';
import type { MouseEventParams, Time } from 'lightweight-charts';

import { panePointOf } from '../src/features/chart/engine/indicators/indicatorPanePoint';

/**
 * Where the chart says the pointer rests: the pane it names and the point in that pane's own CSS pixels,
 * so that the hit test measures no pane and a pointer move costs the page no layout.
 */

/** What the chart reports of a pointer: the point in the pane's own pixels, and the pane it rests in. */
function pointerParam(
  point: { readonly x: number; readonly y: number } | undefined,
  paneIndex: number | undefined,
): MouseEventParams<Time> {
  return { point, paneIndex } as MouseEventParams<Time>;
}

test('a pointer the chart places in a pane reads as that pane and its point', () => {
  expect(panePointOf(pointerParam({ x: 120, y: 34 }, 1))).toEqual({ paneIndex: 1, x: 120, y: 34 });
});

test('a pointer at the pane origin is a point, not an absent one', () => {
  expect(panePointOf(pointerParam({ x: 0, y: 0 }, 0))).toEqual({ paneIndex: 0, x: 0, y: 0 });
});

test('a param raised with no point or no pane reads as no pane point', () => {
  expect(panePointOf(pointerParam(undefined, 1))).toBeNull();
  expect(panePointOf(pointerParam({ x: 120, y: 34 }, undefined))).toBeNull();
  expect(panePointOf(pointerParam(undefined, undefined))).toBeNull();
});
