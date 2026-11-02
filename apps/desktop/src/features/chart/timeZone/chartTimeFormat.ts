import { TickMarkType } from 'lightweight-charts';
import { EXCHANGE_TIME_ZONE, UTC_TIME_ZONE, formatUtcOffset, utcOffsetMinutes } from './chartTimeZones';

export interface ChartTimeFormat {
  pointerLabel(barSeconds: number): string;
  tickMarkLabel(barSeconds: number, tickMarkType: TickMarkType): string | null;
  clockLabel(nowMs: number): string | null;
}

/** The ways a label writes a date: `30 Sep '26`, `30/09/26`, `09/30/26` and `2026-09-30`. */
export const CHART_DATE_FORMATS = ['dayMonthYear', 'dayMonthNumeric', 'monthDayNumeric', 'iso'] as const;

export type ChartDateFormat = (typeof CHART_DATE_FORMATS)[number];

/** The ways a label writes a clock: 24-hour `15:40`, or 12-hour `3:40 PM`. */
export const CHART_HOUR_FORMATS = ['h24', 'h12'] as const;

export type ChartHourFormat = (typeof CHART_HOUR_FORMATS)[number];

/** How the labels write their weekday, their date and their clock. */
export interface ChartTimeLabels {
  readonly dayOfWeek: boolean;
  readonly dateFormat: ChartDateFormat;
  readonly hourFormat: ChartHourFormat;
}

/** The labels the chart has always drawn: the weekday first, `30 Sep '26` dates and a 24-hour clock. */
export const DEFAULT_CHART_TIME_LABELS: ChartTimeLabels = {
  dayOfWeek: true,
  dateFormat: 'dayMonthYear',
  hourFormat: 'h24',
};

/** Whether two label choices would write every label the same way. */
export function sameChartTimeLabels(first: ChartTimeLabels, second: ChartTimeLabels): boolean {
  return (
    first.dayOfWeek === second.dayOfWeek &&
    first.dateFormat === second.dateFormat &&
    first.hourFormat === second.hourFormat
  );
}

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;

/** A wall clock reading at midnight: the one tick time at which a date is the truth about the bar. */
const WALL_MIDNIGHT = '00:00';

/** The fields one hour format's clock is built from; the 12-hour one drops the leading zero and adds AM or PM. */
interface HourFormatOptions {
  readonly locale: string;
  readonly hour: '2-digit' | 'numeric';
  readonly hourCycle: 'h23' | 'h12';
}

const HOUR_FORMAT_OPTIONS: Readonly<Record<ChartHourFormat, HourFormatOptions>> = {
  h24: { locale: 'en-GB', hour: '2-digit', hourCycle: 'h23' },
  h12: { locale: 'en-US', hour: 'numeric', hourCycle: 'h12' },
};

/**
 * The month names the labels write, in calendar order. Current ICU data writes the short month of
 * `en-GB` as `Sept` and other data as `Sep`, so the table is what keeps every engine the same.
 */
export const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The formatters that write a date's own numbers. */
interface DateFormats {
  /** `26`: the two-digit year the date that names its month writes. */
  readonly shortYear: Intl.DateTimeFormat;
  /** `30 09 26`: every number in two digits, for the formats that write numbers alone. */
  readonly numbers: Intl.DateTimeFormat;
  /** `2026`: the four-digit year the ISO date writes. */
  readonly fullYear: Intl.DateTimeFormat;
}

interface ZoneFormats {
  readonly clocks: Readonly<Record<ChartHourFormat, Intl.DateTimeFormat>>;
  readonly clocksWithSeconds: Readonly<Record<ChartHourFormat, Intl.DateTimeFormat>>;
  readonly dates: DateFormats;
  readonly weekday: Intl.DateTimeFormat;
  readonly year: Intl.DateTimeFormat;
  /** The zone's own month as a number, `9`, which the month table names. */
  readonly monthNumber: Intl.DateTimeFormat;
  readonly dayOfMonth: Intl.DateTimeFormat;
}

/**
 * A zone's clock in one hour format, with the extra fields a caller asks for. Broker time never
 * moves by less than a minute, so its seconds are UTC's.
 */
function clockFormat(
  timeZone: string,
  hourFormat: ChartHourFormat,
  fields: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const { locale, hour, hourCycle } = HOUR_FORMAT_OPTIONS[hourFormat];
  return new Intl.DateTimeFormat(locale, { timeZone, hour, minute: '2-digit', hourCycle, ...fields });
}

/** One clock per hour format, so a label reads the one its settings name. */
function clockFormats(
  timeZone: string,
  fields: Intl.DateTimeFormatOptions,
): Readonly<Record<ChartHourFormat, Intl.DateTimeFormat>> {
  return { h24: clockFormat(timeZone, 'h24', fields), h12: clockFormat(timeZone, 'h12', fields) };
}

function dateFormats(timeZone: string): DateFormats {
  return {
    shortYear: new Intl.DateTimeFormat('en-GB', { timeZone, year: '2-digit' }),
    numbers: new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit', year: '2-digit' }),
    fullYear: new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }),
  };
}

/** Every formatter the labels need, built once: the axis and the clock call these constantly. */
function createZoneFormats(timeZone: string): ZoneFormats {
  return {
    clocks: clockFormats(timeZone, {}),
    clocksWithSeconds: clockFormats(timeZone, { second: '2-digit' }),
    dates: dateFormats(timeZone),
    weekday: new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' }),
    year: new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }),
    monthNumber: new Intl.DateTimeFormat('en-GB', { timeZone, month: 'numeric' }),
    dayOfMonth: new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric' }),
  };
}

type DateFieldName = 'day' | 'month' | 'year';

interface DateFields {
  readonly day: string;
  readonly month: string;
  readonly year: string;
}

/** One written date's fields; every format here writes the day, the month and the year. */
function dateFields(format: Intl.DateTimeFormat, at: Date | number): DateFields {
  const parts = format.formatToParts(at);
  const value = (name: DateFieldName) => parts.find((part) => part.type === name)?.value ?? '';
  return { day: value('day'), month: value('month'), year: value('year') };
}

/** `Sep`: the month named from the table, keyed by the month number the zone writes. */
function monthAbbreviation(monthNumber: string): string {
  return MONTH_ABBREVIATIONS[Number(monthNumber) - 1];
}

/** `30/09/26` or `09/30/26`: the same three numbers, in the order the format writes them. */
function numericDateLabel(numbers: Intl.DateTimeFormat, at: Date, order: 'dayMonth' | 'monthDay'): string {
  const { day, month, year } = dateFields(numbers, at);
  return order === 'dayMonth' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
}

/** How each date format writes one date. */
const DATE_LABEL_WRITERS: Readonly<Record<ChartDateFormat, (formats: ZoneFormats, at: Date) => string>> = {
  // `en-GB` pads the day when the month is written as a number, so the day has its own formatter.
  dayMonthYear: (formats, at) => {
    const day = formats.dayOfMonth.format(at);
    const month = monthAbbreviation(formats.monthNumber.format(at));
    const year = formats.dates.shortYear.format(at);
    return `${day} ${month} '${year}`;
  },
  dayMonthNumeric: (formats, at) => numericDateLabel(formats.dates.numbers, at, 'dayMonth'),
  monthDayNumeric: (formats, at) => numericDateLabel(formats.dates.numbers, at, 'monthDay'),
  iso: (formats, at) => {
    const { day, month } = dateFields(formats.dates.numbers, at);
    return `${dateFields(formats.dates.fullYear, at).year}-${month}-${day}`;
  },
};

/** `Wed 30 Sep '26  08:03` — the pointer readout, with the reference's two spaces before the clock. */
function formatPointerLabel(formats: ZoneFormats, labels: ChartTimeLabels, atMs: number): string {
  const at = new Date(atMs);
  const date = DATE_LABEL_WRITERS[labels.dateFormat](formats, at);
  const weekday = labels.dayOfWeek ? `${formats.weekday.format(at)} ` : '';
  return `${weekday}${date}  ${formats.clocks[labels.hourFormat].format(at)}`;
}

function tickDateLabel(formats: ZoneFormats, atMs: number, tickMarkType: TickMarkType): string {
  if (tickMarkType === TickMarkType.Year) {
    return formats.year.format(atMs);
  }
  if (tickMarkType === TickMarkType.Month) {
    return monthAbbreviation(dateFields(formats.monthNumber, atMs).month);
  }
  return formats.dayOfMonth.format(atMs);
}

/**
 * The axis text of a tick. A broker-day boundary is only a date in a zone whose wall clock
 * stands at midnight there; anywhere else the time of day is the honest label. The 24-hour
 * reading is what tells the two apart, so a 12-hour axis still names its days.
 */
function formatTickLabel(
  formats: ZoneFormats,
  labels: ChartTimeLabels,
  atMs: number,
  tickMarkType: TickMarkType,
): string {
  if (tickMarkType === TickMarkType.TimeWithSeconds) {
    return formats.clocksWithSeconds[labels.hourFormat].format(atMs);
  }
  const wallClock = formats.clocks[labels.hourFormat].format(atMs);
  if (tickMarkType === TickMarkType.Time || formats.clocks.h24.format(atMs) !== WALL_MIDNIGHT) {
    return wallClock;
  }
  return tickDateLabel(formats, atMs, tickMarkType);
}

/** `15:40:06 UTC+3` — the broker's wall clock, the time a trader schedules against; null while unknown. */
function brokerClockLabel(
  formats: ZoneFormats,
  labels: ChartTimeLabels,
  nowMs: number,
  brokerUtcOffsetMinutes: number | null,
): string | null {
  if (brokerUtcOffsetMinutes === null) {
    return null;
  }
  const brokerNowMs = nowMs + brokerUtcOffsetMinutes * MS_PER_MINUTE;
  const clock = formats.clocksWithSeconds[labels.hourFormat].format(brokerNowMs);
  return `${clock} ${formatUtcOffset(brokerUtcOffsetMinutes)}`;
}

/** `13:40:06 UTC+1` — the zone's wall clock and the offset in force at that instant. */
function zoneClockLabel(formats: ZoneFormats, labels: ChartTimeLabels, zone: string, nowMs: number): string {
  const clock = formats.clocksWithSeconds[labels.hourFormat].format(nowMs);
  return `${clock} ${formatUtcOffset(utcOffsetMinutes(zone, nowMs))}`;
}

/**
 * Broker time: the bar seconds are already wall clock readings, so they are shown as they are,
 * and the axis keeps the library's own labels. The offset is only needed for the clock.
 */
function createBrokerTimeFormat(brokerUtcOffsetMinutes: number | null, labels: ChartTimeLabels): ChartTimeFormat {
  const formats = createZoneFormats(UTC_TIME_ZONE);
  return {
    pointerLabel: (barSeconds) => formatPointerLabel(formats, labels, barSeconds * MS_PER_SECOND),
    tickMarkLabel: () => null,
    clockLabel: (nowMs) => brokerClockLabel(formats, labels, nowMs, brokerUtcOffsetMinutes),
  };
}

/** A chosen zone: the current broker offset turns every bar into a real instant, which the zone formats. */
function createZoneTimeFormat(zone: string, brokerUtcOffsetMinutes: number, labels: ChartTimeLabels): ChartTimeFormat {
  const formats = createZoneFormats(zone);
  const brokerShiftMs = brokerUtcOffsetMinutes * MS_PER_MINUTE;
  const instantMs = (barSeconds: number) => barSeconds * MS_PER_SECOND - brokerShiftMs;
  return {
    pointerLabel: (barSeconds) => formatPointerLabel(formats, labels, instantMs(barSeconds)),
    tickMarkLabel: (barSeconds, tickMarkType) => formatTickLabel(formats, labels, instantMs(barSeconds), tickMarkType),
    clockLabel: (nowMs) => zoneClockLabel(formats, labels, zone, nowMs),
  };
}

/**
 * Labels for the chosen zone, written the way `labels` asks; without a broker offset the bars can
 * only be read as broker time. The default labels are the ones the chart has always drawn.
 */
export function createChartTimeFormat(
  zone: string,
  brokerUtcOffsetMinutes: number | null,
  labels: ChartTimeLabels = DEFAULT_CHART_TIME_LABELS,
): ChartTimeFormat {
  if (zone === EXCHANGE_TIME_ZONE || brokerUtcOffsetMinutes === null) {
    return createBrokerTimeFormat(brokerUtcOffsetMinutes, labels);
  }
  return createZoneTimeFormat(zone, brokerUtcOffsetMinutes, labels);
}
