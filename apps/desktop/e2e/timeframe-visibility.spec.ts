import { expect, test } from '@playwright/test';
import { readChartDrawingRecord } from '../src/features/chart/engine/drawings/drawingRecord';
import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  TIMEFRAME_COUNTS,
  isShownOnTimeframe,
  readTimeframeVisibility,
  sameTimeframeVisibility,
  snapTimeframeCount,
  type DrawingTimeframeVisibility,
} from '../src/features/chart/engine/drawings/timeframeVisibility';
import { timeframeOptions } from '../src/shared/bridge/timeframes';

/**
 * On which timeframes a drawing paints: the allowed counts come from the shared timeframe config, the
 * check answers per wire code, and a stored value that is missing or malformed reads as shown
 * everywhere. Pure Node, no browser.
 */

/** Minutes 1 to 15, no hours, no weeks: the setting the drawing specs save. */
const RESTRICTED: DrawingTimeframeVisibility = {
  minutes: { shown: true, from: 1, to: 15 },
  hours: { shown: false, from: 1, to: 12 },
  days: true,
  weeks: false,
  months: true,
};

const MINIMAL_RECORD = {
  id: 'drawing-1',
  toolId: 'fixedRangeProfile',
  locked: false,
  visible: true,
  inputs: {},
  points: [{ timeMs: 1_000, price: null }],
};

test('the allowed counts are derived from the timeframe config', () => {
  const countsOf = (prefix: string) =>
    timeframeOptions
      .filter((option) => /^[A-Z]+/.exec(option.wire)?.[0] === prefix)
      .map((option) => Number(option.wire.slice(prefix.length)));
  expect(TIMEFRAME_COUNTS.minutes).toEqual(countsOf('M'));
  expect(TIMEFRAME_COUNTS.hours).toEqual(countsOf('H'));
  expect(TIMEFRAME_COUNTS.minutes[0]).toBe(1);
});

test('the default shows the drawing on every timeframe of the config', () => {
  for (const { wire } of timeframeOptions) {
    expect(isShownOnTimeframe(DEFAULT_TIMEFRAME_VISIBILITY, wire), wire).toBe(true);
  }
});

test('a restricted setting shows minutes inside the range, and each of the hours, days, weeks and months as set', () => {
  const shown = (wire: string) => isShownOnTimeframe(RESTRICTED, wire);
  expect([shown('M1'), shown('M5'), shown('M15'), shown('M30')]).toEqual([true, true, true, false]);
  expect([shown('H1'), shown('H4')]).toEqual([false, false]);
  expect([shown('D1'), shown('W1'), shown('MN1')]).toEqual([true, false, true]);
});

test('an unticked minutes row hides every minute timeframe, and an unknown wire code shows the drawing', () => {
  const noMinutes = { ...DEFAULT_TIMEFRAME_VISIBILITY, minutes: { shown: false, from: 1, to: 30 } };
  expect(isShownOnTimeframe(noMinutes, 'M5')).toBe(false);
  expect(isShownOnTimeframe(noMinutes, 'H1')).toBe(true);
  expect(isShownOnTimeframe(RESTRICTED, 'Y1')).toBe(true);
});

test('a stored setting reads back, and a missing or malformed one reads as shown everywhere', () => {
  expect(readTimeframeVisibility(JSON.parse(JSON.stringify(RESTRICTED)))).toEqual(RESTRICTED);
  for (const invalid of [
    undefined,
    null,
    'text',
    {},
    { ...RESTRICTED, days: 'yes' },
    { ...RESTRICTED, minutes: { shown: true, from: 7, to: 15 } },
    { ...RESTRICTED, minutes: { shown: true, from: 15, to: 5 } },
    { ...RESTRICTED, hours: { shown: true, from: 1, to: 24 } },
    { ...RESTRICTED, minutes: { shown: 1, from: 1, to: 15 } },
  ]) {
    expect(readTimeframeVisibility(invalid)).toEqual(DEFAULT_TIMEFRAME_VISIBILITY);
  }
});

test('a drawing record reads its timeframe setting, and a record without one shows everywhere', () => {
  expect(readChartDrawingRecord({ ...MINIMAL_RECORD, timeframeVisibility: RESTRICTED })?.timeframeVisibility).toEqual(
    RESTRICTED,
  );
  expect(readChartDrawingRecord(MINIMAL_RECORD)?.timeframeVisibility).toEqual(DEFAULT_TIMEFRAME_VISIBILITY);
});

test('a count snaps to the nearest allowed one and the lower wins a tie', () => {
  expect(snapTimeframeCount('minutes', 7)).toBe(6);
  expect(snapTimeframeCount('minutes', 8)).toBe(6);
  expect(snapTimeframeCount('minutes', 11)).toBe(10);
  expect(snapTimeframeCount('minutes', 500)).toBe(30);
  expect(snapTimeframeCount('minutes', -4)).toBe(1);
  expect(snapTimeframeCount('hours', 5)).toBe(4);
  expect(snapTimeframeCount('hours', 9)).toBe(8);
});

test('two settings are the same only when every value matches', () => {
  expect(sameTimeframeVisibility(RESTRICTED, { ...RESTRICTED })).toBe(true);
  expect(sameTimeframeVisibility(RESTRICTED, { ...RESTRICTED, months: false })).toBe(false);
  expect(sameTimeframeVisibility(RESTRICTED, { ...RESTRICTED, minutes: { shown: true, from: 1, to: 12 } })).toBe(false);
});
