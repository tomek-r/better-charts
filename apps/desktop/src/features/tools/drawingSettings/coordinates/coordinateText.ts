import { parsePointPrice, type ChartDrawingPoint } from '../../../chart/engine/drawings/drawingRecord';
import type { ChartDrawingAnchor } from '../../../chart/engine/drawings/toolDrawings';

/**
 * The text of one anchor as the Coordinates tab edits it. Times are UTC, the zone of the chart's time
 * axis; a field the anchor kind does not carry stays empty.
 */
export interface CoordinateRowText {
  /** `YYYY-MM-DD`, the value of a date input. */
  readonly date: string;
  /** `HH:MM`, the value of a time input with a one-minute step: MT5's lowest timeframe is M1. */
  readonly time: string;
  /** Decimal price text, kept as the user wrote it so a stored price is never re-rounded. */
  readonly price: string;
}

export type CoordinateFieldName = keyof CoordinateRowText;

const DATE_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_TEXT = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DATE_CHARS = 10;
const TIME_CHARS_START = 11;
const TIME_CHARS_END = 16;
const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;

/** The row of an anchor that holds nothing yet. */
const EMPTY_ROW: CoordinateRowText = { date: '', time: '', price: '' };

/** The fields one anchor kind asks the user for, which is also the set of fields that can be invalid. */
export function anchorFieldNames(anchor: ChartDrawingAnchor): readonly CoordinateFieldName[] {
  const names: CoordinateFieldName[] = [];
  if (anchor !== 'price') {
    names.push('date', 'time');
  }
  if (anchor !== 'time') {
    names.push('price');
  }
  return names;
}

/** The epoch milliseconds of 00:00 UTC on the date, or undefined when the text is not a real calendar day. */
function utcDayStartMs(date: string): number | undefined {
  const match = DATE_TEXT.exec(date);
  if (match === null) {
    return undefined;
  }
  const dayStartMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // A rolled-over day (02-30) or a two-digit year the Date API maps to 19xx reads back differently.
  return new Date(dayStartMs).toISOString().slice(0, DATE_CHARS) === date ? dayStartMs : undefined;
}

/** The instant rounded to the nearest whole minute: MT5's lowest timeframe is M1, so anchors never carry seconds. */
function nearestMinuteMs(timeMs: number): number {
  return Math.round(timeMs / MS_PER_MINUTE) * MS_PER_MINUTE;
}

/**
 * The milliseconds since midnight the clock text names, on a whole minute, or undefined when it is not a time
 * of day. A typed `HH:MM:SS` is still read (pasted text, an older habit) and rounded to the nearest minute
 * instead of rejected.
 */
function timeOfDayMs(time: string): number | undefined {
  const match = TIME_TEXT.exec(time);
  if (match === null) {
    return undefined;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours >= HOURS_PER_DAY || minutes >= MINUTES_PER_HOUR || seconds >= SECONDS_PER_MINUTE) {
    return undefined;
  }
  return nearestMinuteMs(hours * MS_PER_HOUR + minutes * MS_PER_MINUTE + seconds * MS_PER_SECOND);
}

/** The instant the row's date and time name, or undefined while either is invalid. */
function rowTimeMs({ date, time }: CoordinateRowText): number | undefined {
  const dayStartMs = utcDayStartMs(date);
  const sinceMidnightMs = timeOfDayMs(time);
  return dayStartMs === undefined || sinceMidnightMs === undefined ? undefined : dayStartMs + sinceMidnightMs;
}

/** The text of one stored anchor; a missing time or price leaves its fields empty. */
export function pointToRowText({ timeMs, price }: ChartDrawingPoint): CoordinateRowText {
  if (timeMs === null) {
    return { ...EMPTY_ROW, price: price ?? '' };
  }
  const iso = new Date(nearestMinuteMs(timeMs)).toISOString();
  return { date: iso.slice(0, DATE_CHARS), time: iso.slice(TIME_CHARS_START, TIME_CHARS_END), price: price ?? '' };
}

/** The fields of the row that fail their own rule; empty when the row names a point of that anchor kind. */
export function invalidCoordinateFields(row: CoordinateRowText, anchor: ChartDrawingAnchor): CoordinateFieldName[] {
  const failing: Record<CoordinateFieldName, boolean> = {
    date: utcDayStartMs(row.date) === undefined,
    time: timeOfDayMs(row.time) === undefined,
    price: Number.isNaN(parsePointPrice(row.price)),
  };
  return anchorFieldNames(anchor).filter((name) => failing[name]);
}

/** The anchor a valid row names, or undefined while any field the anchor kind needs is invalid. */
export function rowTextToPoint(row: CoordinateRowText, anchor: ChartDrawingAnchor): ChartDrawingPoint | undefined {
  if (invalidCoordinateFields(row, anchor).length > 0) {
    return undefined;
  }
  return {
    timeMs: anchor === 'price' ? null : (rowTimeMs(row) ?? null),
    price: anchor === 'time' ? null : row.price,
  };
}

/** Whether two lists of rows read the same, field by field. */
export function sameRowTexts(first: readonly CoordinateRowText[], second: readonly CoordinateRowText[]): boolean {
  return (
    first.length === second.length &&
    first.every(
      (row, index) =>
        row.date === second[index].date && row.time === second[index].time && row.price === second[index].price,
    )
  );
}
