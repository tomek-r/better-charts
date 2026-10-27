import { expect, test } from '@playwright/test';
import type { ChartDrawingPoint } from '../src/features/chart/engine/drawings/drawingRecord';
import {
  anchorFieldNames,
  invalidCoordinateFields,
  pointToRowText,
  rowTextToPoint,
  sameRowTexts,
  type CoordinateRowText,
} from '../src/features/tools/drawingSettings/coordinateText';
import { STUB_M5_INTERVAL_MS, STUB_NOW } from './helpers/tauriStub';

/**
 * The Coordinates tab's text conversion: a stored anchor to the date, time and price a field shows and
 * back, in UTC, with each field validated on its own. Pure Node, no browser.
 */

/** A stub-clock instant, so no calendar date is written down here. */
const BAR_MS = STUB_NOW - 3 * STUB_M5_INTERVAL_MS;
const BAR_ISO = new Date(BAR_MS).toISOString();
const BAR_DATE = BAR_ISO.slice(0, 10);
/** `HH:MM`: anchors are whole minutes, MT5's lowest timeframe being M1. */
const BAR_TIME = BAR_ISO.slice(11, 16);

const VALID_ROW: CoordinateRowText = { date: BAR_DATE, time: BAR_TIME, price: '1.0850' };

test('a time and price anchor shows its UTC date, time of day and price text', () => {
  expect(pointToRowText({ timeMs: BAR_MS, price: '1.0850' })).toEqual(VALID_ROW);
});

test('a time-only anchor leaves the price empty and a price-only anchor leaves the date and time empty', () => {
  expect(pointToRowText({ timeMs: BAR_MS, price: null })).toEqual({ ...VALID_ROW, price: '' });
  expect(pointToRowText({ timeMs: null, price: '1.0850' })).toEqual({ date: '', time: '', price: '1.0850' });
});

test('every anchor kind round trips through its text', () => {
  const anchors: Array<[ChartDrawingPoint, 'time' | 'price' | 'timePrice']> = [
    [{ timeMs: BAR_MS, price: null }, 'time'],
    [{ timeMs: null, price: '1.0850' }, 'price'],
    [{ timeMs: BAR_MS, price: '1.0850' }, 'timePrice'],
  ];
  for (const [point, anchor] of anchors) {
    expect(rowTextToPoint(pointToRowText(point), anchor)).toEqual(point);
  }
});

test('the date and time are read as UTC, not as local time', () => {
  const point = rowTextToPoint({ date: '2024-03-10', time: '12:34', price: '' }, 'time');
  expect(point?.timeMs).toBe(Date.UTC(2024, 2, 10, 12, 34));
});

test('a stored anchor with seconds shows the nearest minute: 29 s down, 30 s up', () => {
  const minuteMs = Date.UTC(2024, 2, 10, 12, 34);
  expect(pointToRowText({ timeMs: minuteMs + 29_000, price: null }).time).toBe('12:34');
  expect(pointToRowText({ timeMs: minuteMs + 30_000, price: null }).time).toBe('12:35');
  expect(pointToRowText({ timeMs: Date.UTC(2024, 2, 10, 23, 59, 45), price: null })).toMatchObject({
    date: '2024-03-11',
    time: '00:00',
  });
});

test('a typed time with seconds is tolerated and rounded to the nearest minute, never stored with seconds', () => {
  const read = (time: string) => rowTextToPoint({ date: '2024-03-10', time, price: '' }, 'time')?.timeMs;
  expect(read('12:34:29')).toBe(Date.UTC(2024, 2, 10, 12, 34));
  expect(read('12:34:30')).toBe(Date.UTC(2024, 2, 10, 12, 35));
});

test('a price is carried as written, never re-rounded', () => {
  const point = rowTextToPoint({ ...VALID_ROW, price: '1.08500000000000000001' }, 'timePrice');
  expect(point?.price).toBe('1.08500000000000000001');
});

const INVALID_DATES = ['', '2024-02-30', '2024-13-01', '24-03-10', '2024/03/10', '0050-01-01'];
const INVALID_TIMES = ['', '24:00:00', '12:60:00', '12:00:60', '1:00', '12:00:0x'];
const INVALID_PRICES = ['', '1e5', '1,085', ' 1.085', '1.', '.5', 'abc', '1'.repeat(40)];

for (const date of INVALID_DATES) {
  test(`the date "${date}" is rejected`, () => {
    expect(invalidCoordinateFields({ ...VALID_ROW, date }, 'timePrice')).toEqual(['date']);
    expect(rowTextToPoint({ ...VALID_ROW, date }, 'timePrice')).toBeUndefined();
  });
}

for (const time of INVALID_TIMES) {
  test(`the time "${time}" is rejected`, () => {
    expect(invalidCoordinateFields({ ...VALID_ROW, time }, 'timePrice')).toEqual(['time']);
    expect(rowTextToPoint({ ...VALID_ROW, time }, 'timePrice')).toBeUndefined();
  });
}

for (const price of INVALID_PRICES) {
  test(`the price "${price}" is rejected`, () => {
    expect(invalidCoordinateFields({ ...VALID_ROW, price }, 'timePrice')).toEqual(['price']);
    expect(rowTextToPoint({ ...VALID_ROW, price }, 'timePrice')).toBeUndefined();
  });
}

test('a negative decimal price is accepted, as the record rules allow it', () => {
  expect(invalidCoordinateFields({ ...VALID_ROW, price: '-0.5' }, 'timePrice')).toEqual([]);
});

test('only the fields an anchor kind carries are asked for and checked', () => {
  const empty: CoordinateRowText = { date: '', time: '', price: '' };
  expect(anchorFieldNames('time')).toEqual(['date', 'time']);
  expect(anchorFieldNames('price')).toEqual(['price']);
  expect(anchorFieldNames('timePrice')).toEqual(['date', 'time', 'price']);
  expect(invalidCoordinateFields(empty, 'time')).toEqual(['date', 'time']);
  expect(invalidCoordinateFields(empty, 'price')).toEqual(['price']);
  expect(invalidCoordinateFields({ ...VALID_ROW, price: '' }, 'time')).toEqual([]);
  expect(rowTextToPoint({ ...VALID_ROW, price: '' }, 'time')).toEqual({ timeMs: BAR_MS, price: null });
});

test('rows are the same only when every field reads the same', () => {
  expect(sameRowTexts([VALID_ROW], [{ ...VALID_ROW }])).toBe(true);
  expect(sameRowTexts([VALID_ROW], [{ ...VALID_ROW, time: '00:00:00' }])).toBe(false);
  expect(sameRowTexts([VALID_ROW], [])).toBe(false);
});
