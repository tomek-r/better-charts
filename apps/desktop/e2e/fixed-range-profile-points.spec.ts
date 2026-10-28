import { test, expect } from '@playwright/test';
import type { ChartDrawingPoint } from '../src/features/chart/engine/drawings/drawingRecord';
import type { TimeModel } from '../src/features/chart/engine/bars/timeModel';
import {
  fixedRangeProfilePoints,
  readFixedRangeProfilePoints,
} from '../src/features/tools/fixedRangeProfile/drawing/fixedRangeProfilePoints';
import {
  lastSlotOpenBefore,
  minuteAlignedWindow,
} from '../src/features/tools/fixedRangeProfile/fixedRangeProfileRange';

/**
 * The points one fixed range volume profile drawing stores, and the handle position a restored drawing derives from
 * the current bars. The engine carries the anchors as plain data, so these functions are the only way
 * in and out, and the handle always follows a slot of the bars the drawing is painted against.
 */

const NOW_MS = Date.now();
const ONE_MINUTE_MS = 60_000;
/** The open of the oldest bar every M1 series here starts from, an hour before now. */
const FIRST_BAR_SECONDS = Math.floor(NOW_MS / 1000) - 3_600;

/** The start of the current minute: a window sits on whole-minute boundaries. */
const NOW_MINUTE_MS = Math.floor(NOW_MS / ONE_MINUTE_MS) * ONE_MINUTE_MS;

/** A window from a minute before this minute to this minute: the smallest range the codec accepts. */
const WINDOW = { fromMs: NOW_MINUTE_MS - ONE_MINUTE_MS, endMs: NOW_MINUTE_MS };

/** A bar series the range helpers read: whole seconds, as the chart keeps them. */
function barSeries(timeframe: string, intervalSeconds: number, barTimes: readonly number[]): TimeModel {
  const bars = barTimes.map((time) => ({ time }));
  return { bars, timeframe, intervalSeconds, lastBar: () => bars[bars.length - 1] } as unknown as TimeModel;
}

/** The first instant of the UTC calendar month that holds `timeMs`. */
function monthStartMs(timeMs: number): number {
  const date = new Date(timeMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

/** The first instant of the UTC calendar month `months` from the one that holds `timeMs`. */
function monthStartAfterMs(timeMs: number, months: number): number {
  const start = new Date(monthStartMs(timeMs));
  return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1);
}

test('a window is stored as its two time-only anchors and read back', () => {
  const points = fixedRangeProfilePoints(WINDOW);
  expect(points).toEqual([
    { timeMs: WINDOW.fromMs, price: null },
    { timeMs: WINDOW.endMs, price: null },
  ]);
  expect(readFixedRangeProfilePoints(points)).toEqual(WINDOW);
});

test('a window with seconds rounds each edge to the nearest minute: 29 s down, 30 s up', () => {
  expect(minuteAlignedWindow({ fromMs: WINDOW.fromMs + 29_000, endMs: WINDOW.endMs + 30_000 })).toEqual({
    fromMs: WINDOW.fromMs,
    endMs: WINDOW.endMs + ONE_MINUTE_MS,
  });
});

test('a window that rounds to nothing ends one minute after it starts', () => {
  expect(minuteAlignedWindow({ fromMs: WINDOW.fromMs + 10_000, endMs: WINDOW.fromMs + 25_000 })).toEqual({
    fromMs: WINDOW.fromMs,
    endMs: WINDOW.fromMs + ONE_MINUTE_MS,
  });
});

test('a window already on whole minutes is unchanged', () => {
  expect(minuteAlignedWindow(WINDOW)).toEqual(WINDOW);
});

test('stored anchors with seconds are read back on whole minutes', () => {
  const stored = fixedRangeProfilePoints({
    fromMs: WINDOW.fromMs + 40_000,
    endMs: WINDOW.endMs + ONE_MINUTE_MS + 20_000,
  });
  expect(readFixedRangeProfilePoints(stored)).toEqual({
    fromMs: WINDOW.fromMs + ONE_MINUTE_MS,
    endMs: WINDOW.endMs + ONE_MINUTE_MS,
  });
});

const REJECTED: ReadonlyArray<{ name: string; value: ChartDrawingPoint[] }> = [
  { name: 'no points at all', value: [] },
  { name: 'a single point', value: [{ timeMs: WINDOW.fromMs, price: null }] },
  { name: 'three points', value: [...fixedRangeProfilePoints(WINDOW), { timeMs: WINDOW.endMs, price: null }] },
  {
    name: 'a priced anchor',
    value: [
      { timeMs: WINDOW.fromMs, price: '1.0850' },
      { timeMs: WINDOW.endMs, price: null },
    ],
  },
  {
    name: 'a price-only anchor',
    value: [
      { timeMs: null, price: '1.0850' },
      { timeMs: WINDOW.endMs, price: null },
    ],
  },
  {
    name: 'a reversed window',
    value: [
      { timeMs: WINDOW.endMs, price: null },
      { timeMs: WINDOW.fromMs, price: null },
    ],
  },
  {
    name: 'an empty window',
    value: [
      { timeMs: WINDOW.fromMs, price: null },
      { timeMs: WINDOW.fromMs, price: null },
    ],
  },
];

for (const { name, value } of REJECTED) {
  test(`${name} is not a window`, () => {
    expect(readFixedRangeProfilePoints(value)).toBeUndefined();
  });
}

test('the last slot of a window that ends at a bar open is the bar before it', () => {
  const series = barSeries('M1', 60, [FIRST_BAR_SECONDS, FIRST_BAR_SECONDS + 60, FIRST_BAR_SECONDS + 120]);

  expect(lastSlotOpenBefore(series, (FIRST_BAR_SECONDS + 120) * 1000)).toBe((FIRST_BAR_SECONDS + 60) * 1000);
});

test('an instant in the gap between two bars belongs to the bar that opened before it', () => {
  const series = barSeries('M1', 60, [FIRST_BAR_SECONDS, FIRST_BAR_SECONDS + 60, FIRST_BAR_SECONDS + 300]);

  expect(lastSlotOpenBefore(series, (FIRST_BAR_SECONDS + 300) * 1000)).toBe((FIRST_BAR_SECONDS + 60) * 1000);
});

test('a window ending past the newest bar has its last slot stepped by the timeframe', () => {
  const series = barSeries('M1', 60, [FIRST_BAR_SECONDS, FIRST_BAR_SECONDS + 60]);
  const newestOpenMs = (FIRST_BAR_SECONDS + 60) * 1000;

  // The window ends two minutes past the newest open, so its last slot is the empty one in between.
  expect(lastSlotOpenBefore(series, newestOpenMs + 2 * ONE_MINUTE_MS)).toBe(newestOpenMs + ONE_MINUTE_MS);
});

test('a window that predates the loaded bars has no slot at all', () => {
  const series = barSeries('M1', 60, [FIRST_BAR_SECONDS, FIRST_BAR_SECONDS + 60]);

  expect(lastSlotOpenBefore(series, FIRST_BAR_SECONDS * 1000)).toBeUndefined();
  expect(lastSlotOpenBefore(barSeries('M1', 60, []), NOW_MS)).toBeUndefined();
});

test('monthly bars follow the calendar month that holds the end of the window', () => {
  const monthStarts = [monthStartAfterMs(NOW_MS, -2), monthStartAfterMs(NOW_MS, -1), monthStartMs(NOW_MS)];
  const series = barSeries(
    'MN1',
    2_592_000,
    monthStarts.map((startMs) => startMs / 1000),
  );

  expect(lastSlotOpenBefore(series, monthStartAfterMs(NOW_MS, 1))).toBe(monthStartMs(NOW_MS));
  expect(lastSlotOpenBefore(series, monthStartMs(NOW_MS))).toBe(monthStartAfterMs(NOW_MS, -1));
  // A window that ends two calendar months on still has its last slot one month on.
  expect(lastSlotOpenBefore(series, monthStartAfterMs(NOW_MS, 2))).toBe(monthStartAfterMs(NOW_MS, 1));
});
