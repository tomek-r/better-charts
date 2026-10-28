import { timeframeOptions, timeframeSection } from '../../../../shared/bridge/timeframes';
import { isPlainRecord } from './toolInputs';

/** Minutes or hours of one timeframe family: shown between `from` and `to` counts, both included. */
export interface TimeframeCountRange {
  readonly shown: boolean;
  readonly from: number;
  readonly to: number;
}

/**
 * On which timeframes one drawing is painted. MT5 has minute and hour timeframes with several counts,
 * and exactly one day, week and month timeframe, so those three are plain flags.
 */
export interface DrawingTimeframeVisibility {
  readonly minutes: TimeframeCountRange;
  readonly hours: TimeframeCountRange;
  readonly days: boolean;
  readonly weeks: boolean;
  readonly months: boolean;
}

export type TimeframeCountFamily = 'minutes' | 'hours';

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

const FAMILY_SECONDS: Record<TimeframeCountFamily, number> = {
  minutes: SECONDS_PER_MINUTE,
  hours: SECONDS_PER_HOUR,
};

/** The one-per-unit timeframes above the hours, by wire code. */
const SINGLE_TIMEFRAME_FLAG: Record<string, 'days' | 'weeks' | 'months'> = { D1: 'days', W1: 'weeks', MN1: 'months' };

/** The counts the config offers for a family, ascending: 1, 2, ... 30 minutes, 1, 2, ... 12 hours. */
function countsOf(family: TimeframeCountFamily): readonly number[] {
  return timeframeOptions
    .filter((option) => timeframeSection(option.wire) === family)
    .map((option) => option.seconds / FAMILY_SECONDS[family]);
}

/** The allowed counts per family, derived from `config/timeframes.json`. */
export const TIMEFRAME_COUNTS: Record<TimeframeCountFamily, readonly number[]> = {
  minutes: countsOf('minutes'),
  hours: countsOf('hours'),
};

function everywhereRange(family: TimeframeCountFamily): TimeframeCountRange {
  const counts = TIMEFRAME_COUNTS[family];
  return { shown: true, from: counts[0], to: counts[counts.length - 1] };
}

/** Shown on every timeframe, with the full ranges: what a drawing without the setting reads as. */
export const DEFAULT_TIMEFRAME_VISIBILITY: DrawingTimeframeVisibility = {
  minutes: everywhereRange('minutes'),
  hours: everywhereRange('hours'),
  days: true,
  weeks: true,
  months: true,
};

/** The allowed count nearest to a number; the lower one wins a tie. */
export function snapTimeframeCount(family: TimeframeCountFamily, value: number): number {
  const counts = TIMEFRAME_COUNTS[family];
  return counts.reduce((nearest, count) => (Math.abs(count - value) < Math.abs(nearest - value) ? count : nearest));
}

/** Whether two settings hold the same values. */
export function sameTimeframeVisibility(left: DrawingTimeframeVisibility, right: DrawingTimeframeVisibility): boolean {
  return (
    left.days === right.days &&
    left.weeks === right.weeks &&
    left.months === right.months &&
    sameRange(left.minutes, right.minutes) &&
    sameRange(left.hours, right.hours)
  );
}

function sameRange(left: TimeframeCountRange, right: TimeframeCountRange): boolean {
  return left.shown === right.shown && left.from === right.from && left.to === right.to;
}

function isShownInRange(range: TimeframeCountRange, count: number): boolean {
  return range.shown && count >= range.from && count <= range.to;
}

/** Whether the drawing paints on a timeframe; an unknown wire code shows it, so no drawing vanishes silently. */
export function isShownOnTimeframe(visibility: DrawingTimeframeVisibility, timeframeWire: string): boolean {
  const option = timeframeOptions.find((candidate) => candidate.wire === timeframeWire);
  if (option === undefined) {
    return true;
  }
  const section = timeframeSection(timeframeWire);
  if (section === 'days') {
    const flag = SINGLE_TIMEFRAME_FLAG[timeframeWire];
    return flag === undefined || visibility[flag];
  }
  return isShownInRange(visibility[section], option.seconds / FAMILY_SECONDS[section]);
}

function readCountRange(family: TimeframeCountFamily, value: unknown): TimeframeCountRange | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const { shown, from, to } = value;
  const counts = TIMEFRAME_COUNTS[family];
  if (typeof shown !== 'boolean' || typeof from !== 'number' || typeof to !== 'number') {
    return undefined;
  }
  if (!counts.includes(from) || !counts.includes(to) || from > to) {
    return undefined;
  }
  return { shown, from, to };
}

/**
 * The visibility a stored value holds. A missing value is the default; so is anything malformed, because
 * a drawing must stay visible rather than disappear on a bad file.
 */
export function readTimeframeVisibility(value: unknown): DrawingTimeframeVisibility {
  if (!isPlainRecord(value)) {
    return DEFAULT_TIMEFRAME_VISIBILITY;
  }
  const minutes = readCountRange('minutes', value.minutes);
  const hours = readCountRange('hours', value.hours);
  const { days, weeks, months } = value;
  if (minutes === undefined || hours === undefined) {
    return DEFAULT_TIMEFRAME_VISIBILITY;
  }
  if (typeof days !== 'boolean' || typeof weeks !== 'boolean' || typeof months !== 'boolean') {
    return DEFAULT_TIMEFRAME_VISIBILITY;
  }
  return { minutes, hours, days, weeks, months };
}
