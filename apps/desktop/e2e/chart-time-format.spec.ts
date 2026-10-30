import { expect, test } from '@playwright/test';
import { TickMarkType } from 'lightweight-charts';
import { createChartTimeFormat } from '../src/features/chart/timeZone/chartTimeFormat';
import { EXCHANGE_TIME_ZONE, UTC_TIME_ZONE } from '../src/features/chart/timeZone/chartTimeZones';

/** The time axis, pointer and clock text of a chosen zone. Pure Node. */

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const BROKER_OFFSET_MINUTES = 180;

/** `HH:mm:ss` of an instant read as UTC, from the raw Date fields rather than a formatter. */
function utcTimeText(atMs: number): string {
  const at = new Date(atMs);
  const hands = [at.getUTCHours(), at.getUTCMinutes(), at.getUTCSeconds()];
  return hands.map((hand) => String(hand).padStart(2, '0')).join(':');
}

function utcHourMinuteText(atMs: number): string {
  return utcTimeText(atMs).slice(0, 5);
}

const DATE_TICK_MARK_TYPES: readonly TickMarkType[] = [TickMarkType.Year, TickMarkType.Month, TickMarkType.DayOfMonth];

const TICK_MARK_TYPES: readonly TickMarkType[] = [
  ...DATE_TICK_MARK_TYPES,
  TickMarkType.Time,
  TickMarkType.TimeWithSeconds,
];

/** Now on a whole minute, so the expectations derived from it are exact to the second. */
const utcMs = Math.floor(Date.now() / MS_PER_MINUTE) * MS_PER_MINUTE;
const utcNow = new Date(utcMs);
/** The bar time of `utcMs`: the broker's wall clock, three hours ahead. */
const brokerBarSeconds = (utcMs + BROKER_OFFSET_MINUTES * MS_PER_MINUTE) / MS_PER_SECOND;
const utcBarSeconds = utcMs / MS_PER_SECOND;
/** Midnight on the broker calendar, where the axis puts its date ticks. */
const brokerMidnightMs = Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth(), utcNow.getUTCDate());
const brokerMidnightSeconds = brokerMidnightMs / MS_PER_SECOND;
/** Broker midnight in UTC terms: the wall time the axis shows when the day boundary is not local. */
const brokerMidnightWallTime = utcHourMinuteText(brokerMidnightMs - BROKER_OFFSET_MINUTES * MS_PER_MINUTE);

const SHORT_MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: UTC_TIME_ZONE, month: 'short' });

test('the pointer label keeps the reference layout', () => {
  const label = createChartTimeFormat(UTC_TIME_ZONE, 0).pointerLabel(utcBarSeconds);
  expect(label).toMatch(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} '\d{2} {2}\d{2}:\d{2}$/);
});

test('the exchange pointer label is the bar read as broker wall time', () => {
  const label = createChartTimeFormat(EXCHANGE_TIME_ZONE, BROKER_OFFSET_MINUTES).pointerLabel(brokerBarSeconds);
  expect(label.endsWith(`  ${utcHourMinuteText(brokerBarSeconds * MS_PER_SECOND)}`)).toBe(true);
});

test('the exchange leaves every axis tick to the library', () => {
  const format = createChartTimeFormat(EXCHANGE_TIME_ZONE, BROKER_OFFSET_MINUTES);
  for (const tickMarkType of TICK_MARK_TYPES) {
    expect(format.tickMarkLabel(utcBarSeconds, tickMarkType)).toBeNull();
  }
});

test('an unknown broker offset can only show broker time', () => {
  const unknownOffset = createChartTimeFormat('America/New_York', null);
  for (const tickMarkType of TICK_MARK_TYPES) {
    expect(unknownOffset.tickMarkLabel(brokerBarSeconds, tickMarkType)).toBeNull();
  }
  const brokerTime = createChartTimeFormat(EXCHANGE_TIME_ZONE, BROKER_OFFSET_MINUTES);
  expect(unknownOffset.pointerLabel(brokerBarSeconds)).toBe(brokerTime.pointerLabel(brokerBarSeconds));
  expect(unknownOffset.clockLabel(utcMs)).toBeNull();
});

test('UTC shows the real instant of the bar', () => {
  const label = createChartTimeFormat(UTC_TIME_ZONE, BROKER_OFFSET_MINUTES).pointerLabel(brokerBarSeconds);
  expect(label.endsWith(`  ${utcHourMinuteText(utcMs)}`)).toBe(true);
});

test('UTC ticks show the bar time', () => {
  const format = createChartTimeFormat(UTC_TIME_ZONE, BROKER_OFFSET_MINUTES);
  expect(format.tickMarkLabel(brokerBarSeconds, TickMarkType.Time)).toBe(utcHourMinuteText(utcMs));
  expect(format.tickMarkLabel(brokerBarSeconds, TickMarkType.TimeWithSeconds)).toBe(utcTimeText(utcMs));
});

test('a broker midnight that is not a local midnight shows the time', () => {
  const format = createChartTimeFormat(UTC_TIME_ZONE, BROKER_OFFSET_MINUTES);
  for (const tickMarkType of DATE_TICK_MARK_TYPES) {
    expect(format.tickMarkLabel(brokerMidnightSeconds, tickMarkType)).toBe(brokerMidnightWallTime);
  }
});

test('a broker midnight names the day, the month and the year', () => {
  const format = createChartTimeFormat(UTC_TIME_ZONE, 0);
  const dayOfMonth = String(utcNow.getUTCDate());
  const shortMonth = SHORT_MONTH_FORMAT.format(brokerMidnightMs);
  const year = String(utcNow.getUTCFullYear());
  expect(format.tickMarkLabel(brokerMidnightSeconds, TickMarkType.DayOfMonth)).toBe(dayOfMonth);
  expect(format.tickMarkLabel(brokerMidnightSeconds, TickMarkType.Month)).toBe(shortMonth);
  expect(format.tickMarkLabel(brokerMidnightSeconds, TickMarkType.Year)).toBe(year);
});

test('the UTC clock shows the UTC time and the UTC offset', () => {
  const clock = createChartTimeFormat(UTC_TIME_ZONE, BROKER_OFFSET_MINUTES).clockLabel(utcMs) ?? '';
  expect(clock).toMatch(/^\d{2}:\d{2}:\d{2} UTC$/);
  expect(clock.startsWith(utcTimeText(utcMs))).toBe(true);
});

test('the exchange clock shows the broker wall clock and its offset', () => {
  const clock = createChartTimeFormat(EXCHANGE_TIME_ZONE, BROKER_OFFSET_MINUTES).clockLabel(utcMs) ?? '';
  expect(clock).toMatch(/^\d{2}:\d{2}:\d{2} UTC\+3$/);
  expect(clock.startsWith(utcTimeText(utcMs + BROKER_OFFSET_MINUTES * MS_PER_MINUTE))).toBe(true);
});
