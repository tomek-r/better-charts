import { expect, test } from '@playwright/test';
import { TickMarkType } from 'lightweight-charts';
import {
  createChartTimeFormat,
  DEFAULT_CHART_TIME_LABELS,
  type ChartTimeLabels,
} from '../src/features/chart/timeZone/chartTimeFormat';
import { UTC_TIME_ZONE } from '../src/features/chart/timeZone/chartTimeZones';

/**
 * The labels the Scales and lines tab's time settings write: the weekday, the date format and the
 * hour format, on the pointer readout, the time axis and the footer clock. Pure Node.
 */

const MS_PER_SECOND = 1000;
/** Wednesday 30 September 2026, 08:03:20 UTC: a weekday, a month name and a clock to read back. */
const INSTANT_SECONDS = Date.UTC(2026, 8, 30, 8, 3, 20) / MS_PER_SECOND;
/** Thursday 3 September of that year: the day of the month has a single digit. */
const SINGLE_DIGIT_DAY_SECONDS = Date.UTC(2026, 8, 3, 8, 3, 20) / MS_PER_SECOND;
/** Midnight on that same day, where the axis puts its date ticks. */
const MIDNIGHT_SECONDS = Date.UTC(2026, 8, 30) / MS_PER_SECOND;
/** UTC at no offset: the bar seconds are the instant, so every expected string is exact. */
const UTC_OFFSET_MINUTES = 0;

/** The chart's format with one label choice changed, the rest left as the chart has always drawn them. */
function formatWith(labels: Partial<ChartTimeLabels> = {}) {
  return createChartTimeFormat(UTC_TIME_ZONE, UTC_OFFSET_MINUTES, { ...DEFAULT_CHART_TIME_LABELS, ...labels });
}

function pointerLabel(labels: Partial<ChartTimeLabels> = {}): string {
  return formatWith(labels).pointerLabel(INSTANT_SECONDS);
}

test('the default labels write the pointer text the chart has always shown', () => {
  expect(pointerLabel()).toBe("Wed 30 Sep '26  08:03");
});

test('a day-and-month date writes the day, the month name and the short year', () => {
  expect(pointerLabel({ dateFormat: 'dayMonthYear' })).toBe("Wed 30 Sep '26  08:03");
});

test('a day-and-month date does not pad the day of the month', () => {
  expect(formatWith().pointerLabel(SINGLE_DIGIT_DAY_SECONDS)).toBe("Thu 3 Sep '26  08:03");
});

test('a numeric date writes the day, the month and the year in two digits', () => {
  expect(pointerLabel({ dateFormat: 'dayMonthNumeric' })).toBe('Wed 30/09/26  08:03');
});

test('a month-first date writes the month before the day', () => {
  expect(pointerLabel({ dateFormat: 'monthDayNumeric' })).toBe('Wed 09/30/26  08:03');
});

test('an ISO date writes the year first', () => {
  expect(pointerLabel({ dateFormat: 'iso' })).toBe('Wed 2026-09-30  08:03');
});

test('a label without the weekday starts on its date', () => {
  expect(pointerLabel({ dayOfWeek: false })).toBe("30 Sep '26  08:03");
});

test('a 12-hour clock writes a single-digit hour and its meridiem', () => {
  expect(pointerLabel({ hourFormat: 'h12' })).toBe("Wed 30 Sep '26  8:03 AM");
});

test('the 12-hour clock writes both of the axis labels it shows', () => {
  const format = formatWith({ hourFormat: 'h12' });
  expect(format.tickMarkLabel(INSTANT_SECONDS, TickMarkType.Time)).toBe('8:03 AM');
  expect(format.tickMarkLabel(INSTANT_SECONDS, TickMarkType.TimeWithSeconds)).toBe('8:03:20 AM');
});

test('a date tick names its day, its month and its year on a 12-hour clock too', () => {
  const format = formatWith({ hourFormat: 'h12' });
  expect(format.tickMarkLabel(MIDNIGHT_SECONDS, TickMarkType.DayOfMonth)).toBe('30');
  expect(format.tickMarkLabel(MIDNIGHT_SECONDS, TickMarkType.Month)).toBe('Sep');
  expect(format.tickMarkLabel(MIDNIGHT_SECONDS, TickMarkType.Year)).toBe('2026');
});

test('the footer clock keeps its seconds and follows the hour format', () => {
  const atMs = INSTANT_SECONDS * MS_PER_SECOND;
  expect(formatWith().clockLabel(atMs)).toBe('08:03:20 UTC');
  expect(formatWith({ hourFormat: 'h12' }).clockLabel(atMs)).toBe('8:03:20 AM UTC');
});
