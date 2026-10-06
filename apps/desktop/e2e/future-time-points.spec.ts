import { test, expect } from '@playwright/test';
import { futurePoints, neededFutureBarCount, timeScaleBaseIndex } from '../src/features/chart/engine/futureTimePoints';

/** Pure formulas behind the time-scale padding; no chart or browser needed. */

test('counts the helper points the pane needs at the current spacing', () => {
  // MARGIN_BARS is deliberately not asserted: the +100 headroom exceeds it at
  // every non-negative width, so the floor can never bind. These pin the headroom.
  expect(neededFutureBarCount(800, 10)).toBe(180);
  expect(neededFutureBarCount(0, 10)).toBe(100);
});

test('floors the divisor so a collapsed spacing stays finite', () => {
  expect(neededFutureBarCount(800, 0)).toBe(1700);
  expect(neededFutureBarCount(800, 0.1)).toBe(1700);
});

test('anchors the base index on the last real bar plus the offset', () => {
  expect(timeScaleBaseIndex(12, 5)).toBe(16);
  expect(timeScaleBaseIndex(12, 0)).toBe(11);
});

test('spaces the helper points one interval apart from the last real bar', () => {
  expect(futurePoints(1000, 'M1', 1.086, 3)).toEqual([
    { time: 1060, value: 1.086 },
    { time: 1120, value: 1.086 },
    { time: 1180, value: 1.086 },
  ]);
});

test('produces no helper points when none are needed', () => {
  expect(futurePoints(1000, 'M1', 1.086, 0)).toEqual([]);
});
