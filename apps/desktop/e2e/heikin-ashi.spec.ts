import { expect, test } from '@playwright/test';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { heikinAshiBars, nextHeikinAshiBar } from '../src/features/chart/engine/barStyle/heikinAshi';

/**
 * The Heikin Ashi formula: the close averages the four prices, the open is the middle of the closes before
 * it, and the range spans them. The numbers below are worked out by hand from the raw bars they chain.
 */

/** Raw bars whose prices are all halves and quarters, so every Heikin Ashi price is exact in binary. */
const FIRST_BAR: RenderBar = { time: 1_700_000_000, open: 10, high: 11, low: 9, close: 10.5, volume: 100 };
const SECOND_BAR: RenderBar = { time: 1_700_000_060, open: 10.5, high: 12, low: 10, close: 11.5, volume: 110 };
const THIRD_BAR: RenderBar = { time: 1_700_000_120, open: 11, high: 11.5, low: 10.5, close: 11, volume: 120 };

test('three bars chain into the Heikin Ashi bars worked out by hand', () => {
  expect(heikinAshiBars([FIRST_BAR, SECOND_BAR, THIRD_BAR])).toEqual([
    // close (10 + 11 + 9 + 10.5)/4, open (10 + 10.5)/2, the range spanning both.
    { time: 1_700_000_000, open: 10.25, high: 11, low: 9, close: 10.125, volume: 100 },
    // close (10.5 + 12 + 10 + 11.5)/4, open (10.25 + 10.125)/2.
    { time: 1_700_000_060, open: 10.1875, high: 12, low: 10, close: 11, volume: 110 },
    // close (11 + 11.5 + 10.5 + 11)/4, open (10.1875 + 11)/2.
    { time: 1_700_000_120, open: 10.59375, high: 11.5, low: 10.5, close: 11, volume: 120 },
  ]);
});

test('a replaced last bar chains on the Heikin Ashi bar before it, not on the raw bar', () => {
  const heikinAshi = heikinAshiBars([FIRST_BAR, SECOND_BAR]);
  const replaced = { ...THIRD_BAR, open: 11.75, high: 12.25, low: 10.75, close: 11.25 };

  const chained = nextHeikinAshiBar(replaced, heikinAshi[1]);

  expect(chained).toEqual({
    time: 1_700_000_120,
    // The middle of the Heikin Ashi closes before it: (10.1875 + 11)/2, not (10.5 + 11.5)/2.
    open: 10.59375,
    high: 12.25,
    low: 10.59375,
    close: 11.5,
    volume: 120,
  });
  expect(chained.open).not.toBe((SECOND_BAR.open + SECOND_BAR.close) / 2);
  expect(chained).toEqual(heikinAshiBars([FIRST_BAR, SECOND_BAR, replaced])[2]);
});

test('the first Heikin Ashi bar opens in the middle of its own open and close', () => {
  expect(nextHeikinAshiBar(FIRST_BAR, undefined).open).toBe((FIRST_BAR.open + FIRST_BAR.close) / 2);
  expect(nextHeikinAshiBar(FIRST_BAR, undefined).open).toBe(10.25);
});
