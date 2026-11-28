/**
 * The chart timeframes the bridge supports — read from the shared config
 * `config/timeframes.json`, which `crates/trading-core/src/protocol/timeframes.rs`
 * embeds at compile time. One file, both languages: edit the JSON, never a copy.
 *
 * `label` is presentation only, derived from the wire code (`M15` → `15m`,
 * `H1` → `1H`) so the tabs cannot disagree with the contract.
 *
 * The bar-time helpers below also know the interval codes the config does not
 * list (`M7`, `S5`, `H5`, `D5`, `W2`, `MN4` …), because the countdown, the future
 * time points and the drawing anchors step on the bars the chart draws.
 */
import config from '../../../../../config/timeframes.json' with { type: 'json' };

/** Wire code shape: a unit and an amount (`M15`, `H1`, `MN1`). Declared before
 *  the options below, which label each code while this module initialises. */
const WIRE_CODE = /^(MN|[A-Z])(\d+)$/;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const SECONDS_PER_WEEK = 7 * SECONDS_PER_DAY;

/** Fixed span of a unit. `MN` counts calendar months instead. */
const UNIT_SECONDS: Record<string, number> = {
  S: 1,
  M: SECONDS_PER_MINUTE,
  H: SECONDS_PER_HOUR,
  D: SECONDS_PER_DAY,
  W: SECONDS_PER_WEEK,
};

/** Intraday units: their bars restart at each day's 00:00 unless a bar divides the day evenly. */
const INTRADAY_UNITS = new Set(['S', 'M', 'H']);

export const timeframeOptions = config.timeframes.map((entry) => ({
  wire: entry.code,
  label: timeframeLabel(entry.code),
  seconds: entry.seconds,
}));

/** Requested on connect, and the fallback while no timeframe is known yet. */
export const DEFAULT_TIMEFRAME: string = config.default;

/** `M15` → `15m`, `H1` → `1H`; an unexpected code is shown as it came. */
export function timeframeLabel(wire: string): string {
  const match = WIRE_CODE.exec(wire);
  if (!match) {
    return wire;
  }
  const [, unit, amount] = match;
  if (unit === 'M') {
    return `${amount}m`;
  }
  if (unit === 'MN') {
    return `${amount}M`;
  }
  return `${amount}${unit}`;
}

const LONG_UNITS: Record<string, string> = { M: 'minute', H: 'hour', D: 'day', W: 'week', MN: 'month' };

/** `M3` → `3 minutes`, `H1` → `1 hour`, `MN1` → `1 month`; an unexpected code is shown as it came. */
export function timeframeLongLabel(wire: string): string {
  const match = WIRE_CODE.exec(wire);
  const unit = match ? LONG_UNITS[match[1]] : undefined;
  if (!match || !unit) {
    return wire;
  }
  return `${match[2]} ${unit}${match[2] === '1' ? '' : 's'}`;
}

export type TimeframeSection = 'minutes' | 'hours' | 'days';

/** Menu grouping: minutes, hours, and everything from a day upward. */
export function timeframeSection(wire: string): TimeframeSection {
  const unit = WIRE_CODE.exec(wire)?.[1];
  if (unit === 'M') {
    return 'minutes';
  }
  return unit === 'H' ? 'hours' : 'days';
}

interface WireCode {
  unit: string;
  count: number;
}

/** `M7` → 7 minutes, `MN4` → 4 calendar months. A tick or unknown code has no unit span. */
function parseWireCode(wire: string): WireCode | undefined {
  const match = WIRE_CODE.exec(wire);
  if (!match) {
    return undefined;
  }
  return { unit: match[1], count: Number(match[2]) };
}

function configuredSeconds(wire: string): number | undefined {
  return config.timeframes.find((entry) => entry.code === wire)?.seconds;
}

const defaultEntry = config.timeframes.find((entry) => entry.code === config.default) ?? config.timeframes[0];

/** One calendar month is the configured `MN1` span, so `MN4` is four of those. */
const CALENDAR_MONTH_SECONDS = configuredSeconds('MN1') ?? defaultEntry.seconds;

/** Nominal seconds per bar: the config entry, else the code's own unit, else the default. */
export function timeframeSeconds(wire: string): number {
  return configuredSeconds(wire) ?? derivedSeconds(wire) ?? defaultEntry.seconds;
}

/** A code the config omits: `M7` is 7 minutes, `MN4` is 4 calendar months. */
function derivedSeconds(wire: string): number | undefined {
  const code = parseWireCode(wire);
  if (!code || code.count <= 0) {
    return undefined;
  }
  if (code.unit === 'MN') {
    return code.count * CALENDAR_MONTH_SECONDS;
  }
  const unitSeconds = UNIT_SECONDS[code.unit];
  if (unitSeconds === undefined) {
    return undefined;
  }
  return code.count * unitSeconds;
}

/**
 * Bar boundary `offset` bars after `startSeconds`, the inverse of `timeframeBarOffset`.
 * Callers pass whole offsets from a bar boundary: future points, drawing anchors, the countdown.
 */
export function timeframeBarTime(wire: string, startSeconds: number, offset: number): number {
  const code = parseWireCode(wire);
  if (code?.unit === 'MN') {
    return addCalendarMonths(startSeconds, offset * code.count);
  }
  const barLength = timeframeSeconds(wire);
  if (usesDayGrid(code, barLength)) {
    return dayGridTimeAtIndex(dayGridIndexAt(startSeconds, barLength) + offset, barLength);
  }
  return startSeconds + offset * barLength;
}

/** Fractional bar offset, including times inside a calendar month or a short last day bar. */
export function timeframeBarOffset(wire: string, startSeconds: number, timeSeconds: number): number {
  const code = parseWireCode(wire);
  if (code?.unit === 'MN') {
    return calendarMonthOffset(startSeconds, timeSeconds, code.count);
  }
  const barLength = timeframeSeconds(wire);
  if (usesDayGrid(code, barLength)) {
    return dayGridIndexAt(timeSeconds, barLength) - dayGridIndexAt(startSeconds, barLength);
  }
  return (timeSeconds - startSeconds) / barLength;
}

/**
 * The drawn intraday grid restarts at each day's own 00:00 (broker time is encoded as UTC
 * seconds, so a day is `floor(t / 86400)`). A bar length that does not divide the day
 * therefore leaves one short bar before midnight instead of running into the next day.
 */
function usesDayGrid(code: WireCode | undefined, barLength: number): boolean {
  return code !== undefined && INTRADAY_UNITS.has(code.unit) && SECONDS_PER_DAY % barLength !== 0;
}

/** Bars in one day of the grid, the last one short when the length does not divide the day. */
function dayGridBarsPerDay(barLength: number): number {
  return Math.ceil(SECONDS_PER_DAY / barLength);
}

/** Fractional bar index of an instant, counting the grid's bars from the epoch day onward. */
function dayGridIndexAt(timeSeconds: number, barLength: number): number {
  const day = Math.floor(timeSeconds / SECONDS_PER_DAY);
  const secondsIntoDay = timeSeconds - day * SECONDS_PER_DAY;
  const slot = Math.floor(secondsIntoDay / barLength);
  const lengthInDay = Math.min(barLength, SECONDS_PER_DAY - slot * barLength);
  const withinBar = (secondsIntoDay - slot * barLength) / lengthInDay;
  return day * dayGridBarsPerDay(barLength) + slot + withinBar;
}

/** Opening instant of a bar index: its day's 00:00 plus the bar's slot times the bar length. */
function dayGridTimeAtIndex(index: number, barLength: number): number {
  const barsPerDay = dayGridBarsPerDay(barLength);
  const day = Math.floor(index / barsPerDay);
  return day * SECONDS_PER_DAY + (index - day * barsPerDay) * barLength;
}

/** Same instant a number of calendar months later, on the 1st because monthly bars open there. */
function addCalendarMonths(startSeconds: number, months: number): number {
  const start = new Date(startSeconds * 1000);
  return (
    Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth() + months,
      1,
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
    ) / 1000
  );
}

/** `MN<n>` offset: whole calendar months plus the fraction of the current month, divided by n. */
function calendarMonthOffset(startSeconds: number, timeSeconds: number, monthsPerBar: number): number {
  const start = new Date(startSeconds * 1000);
  const time = new Date(timeSeconds * 1000);
  let months = (time.getUTCFullYear() - start.getUTCFullYear()) * 12 + time.getUTCMonth() - start.getUTCMonth();
  if (timeSeconds < addCalendarMonths(startSeconds, months)) {
    months--;
  }
  const from = addCalendarMonths(startSeconds, months);
  const to = addCalendarMonths(startSeconds, months + 1);
  const withinMonth = (timeSeconds - from) / (to - from);
  return (months + withinMonth) / monthsPerBar;
}
