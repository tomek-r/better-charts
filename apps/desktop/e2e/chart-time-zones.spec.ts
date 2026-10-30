import { expect, test } from '@playwright/test';
import {
  EXCHANGE_TIME_ZONE,
  UTC_TIME_ZONE,
  chartTimeZoneOptions,
  formatUtcOffset,
  isKnownChartTimeZone,
  utcOffsetMinutes,
} from '../src/features/chart/timeZone/chartTimeZones';

/** The zone menu and the UTC offsets it prints. Pure Node. */

const OFFSET_TEXTS: ReadonlyArray<[number, string]> = [
  [0, 'UTC'],
  [60, 'UTC+1'],
  [-180, 'UTC-3'],
  [330, 'UTC+5:30'],
  [345, 'UTC+5:45'],
  [-570, 'UTC-9:30'],
];

for (const [minutes, text] of OFFSET_TEXTS) {
  test(`formats an offset of ${minutes} minutes as ${text}`, () => {
    expect(formatUtcOffset(minutes)).toBe(text);
  });
}

test('the menu lists UTC first and the exchange second', () => {
  const options = chartTimeZoneOptions(Date.now());
  expect(options[0]).toEqual({ zone: UTC_TIME_ZONE, label: 'UTC' });
  expect(options[1]).toEqual({ zone: EXCHANGE_TIME_ZONE, label: 'Exchange' });
});

test('every city is listed as its offset and its name', () => {
  const cityOptions = chartTimeZoneOptions(Date.now()).slice(2);
  expect(cityOptions.length).toBeGreaterThan(80);
  for (const option of cityOptions) {
    expect(option.label).toMatch(/^\(UTC([+-]\d{1,2}(:\d{2})?)?\) .+$/);
  }
});

test('a city label carries the offset in force now', () => {
  const atMs = Date.now();
  for (const option of chartTimeZoneOptions(atMs).slice(2)) {
    expect(option.label.startsWith(`(${formatUtcOffset(utcOffsetMinutes(option.zone, atMs))}) `)).toBe(true);
  }
});

test('the cities run from the earliest offset to the latest', () => {
  const atMs = Date.now();
  let previousOffset = Number.NEGATIVE_INFINITY;
  for (const option of chartTimeZoneOptions(atMs).slice(2)) {
    const offset = utcOffsetMinutes(option.zone, atMs);
    expect(offset).toBeGreaterThanOrEqual(previousOffset);
    previousOffset = offset;
  }
});

test('New York is on the menu', () => {
  expect(chartTimeZoneOptions(Date.now()).map((option) => option.zone)).toContain('America/New_York');
});

test('UTC has no offset', () => {
  expect(utcOffsetMinutes(UTC_TIME_ZONE, Date.now())).toBe(0);
});

test('Kolkata is five and a half hours ahead of UTC', () => {
  expect(utcOffsetMinutes('Asia/Kolkata', Date.now())).toBe(330);
});

test('Kathmandu is five and three quarter hours ahead of UTC', () => {
  expect(utcOffsetMinutes('Asia/Kathmandu', Date.now())).toBe(345);
});

// DST is a calendar edge, so these two instants are pinned instead of derived from Date.now().
test('New York is five hours behind UTC in January', () => {
  expect(utcOffsetMinutes('America/New_York', Date.UTC(2026, 0, 15, 12))).toBe(-300);
});

test('New York is four hours behind UTC in July', () => {
  expect(utcOffsetMinutes('America/New_York', Date.UTC(2026, 6, 15, 12))).toBe(-240);
});

test('the exchange, UTC and a listed city are known zones', () => {
  expect(isKnownChartTimeZone(EXCHANGE_TIME_ZONE)).toBe(true);
  expect(isKnownChartTimeZone(UTC_TIME_ZONE)).toBe(true);
  expect(isKnownChartTimeZone('America/New_York')).toBe(true);
});

test('a zone this build no longer offers is unknown', () => {
  expect(isKnownChartTimeZone('Mars/Olympus_Mons')).toBe(false);
});
