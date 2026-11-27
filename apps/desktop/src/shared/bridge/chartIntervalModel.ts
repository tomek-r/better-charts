/**
 * One model for every chart interval the app can name. Codes are MT5-shaped, so a
 * native timeframe's code is already its `config/timeframes.json` code: `T<n>` bars
 * of n raw ticks, `S<n>` bars of n seconds, and the time units `M<n>` minutes,
 * `H<n>` hours, `D<n>` days, `W<n>` weeks and `MN<n>` months.
 *
 * A time code the config carries is native and MT5 draws it. Any other, within its
 * unit's cap, is aggregated from the largest native timeframe of that unit dividing
 * it — `M90` from `M30`, `H5` from `H1` — which a later slice builds.
 */
import { timeframeLabel, timeframeLongLabel, timeframeOptions } from './timeframes';

/** The ticks one bar may group: a tick chart beyond this is no tick chart, and the parser refuses it. */
export const MAX_TICKS_PER_BAR = 100_000;

/** One day of seconds: a longer second bar would be a time interval instead. */
export const MAX_SECONDS_PER_BAR = 86_400;

/** One day of minutes. */
export const MAX_MINUTES_PER_BAR = 1_440;

/** One day of hours. */
export const MAX_HOURS_PER_BAR = 24;

/** One year of days. */
export const MAX_DAYS_PER_BAR = 365;

/** One year of weeks. */
export const MAX_WEEKS_PER_BAR = 52;

/** One year of months. */
export const MAX_MONTHS_PER_BAR = 12;

/** The units the time codes count in, spelled as the codes spell them. */
const TIME_UNIT_LETTERS = ['M', 'H', 'D', 'W', 'MN'] as const;

export type TimeUnit = (typeof TIME_UNIT_LETTERS)[number];

/** The caps of the time units, keyed by the unit their codes spell. */
const TIME_UNIT_MAX_COUNTS: Readonly<Record<TimeUnit, number>> = {
  M: MAX_MINUTES_PER_BAR,
  H: MAX_HOURS_PER_BAR,
  D: MAX_DAYS_PER_BAR,
  W: MAX_WEEKS_PER_BAR,
  MN: MAX_MONTHS_PER_BAR,
};

/** One interval the chart can be on. */
export type ChartInterval =
  | { readonly kind: 'native'; readonly code: string }
  | { readonly kind: 'ticks'; readonly code: string; readonly ticksPerBar: number }
  | { readonly kind: 'seconds'; readonly code: string; readonly seconds: number }
  | {
      readonly kind: 'aggregated';
      readonly code: string;
      readonly unit: TimeUnit;
      readonly count: number;
      /** The largest native timeframe of the same unit that divides `count`. */
      readonly base: string;
    };

/** Code shape: a unit of one or two letters and its count, never leading a zero: `M7`, `MN4`, `T37`. */
const CODE_SHAPE = /^([A-Z]{1,2})([1-9]\d*)$/;

/** The codes the contract's timeframes carry, whose bars MT5 draws itself. */
const NATIVE_TIMEFRAME_CODES = new Set(timeframeOptions.map(({ wire }) => wire));

/** A code split into the unit and count the model builds an interval from. */
type CodeParts =
  | { readonly code: string; readonly kind: 'ticks'; readonly count: number }
  | { readonly code: string; readonly kind: 'seconds'; readonly count: number }
  | { readonly code: string; readonly kind: 'time'; readonly unit: TimeUnit; readonly count: number };

/** Whether the unit letter of a code counts a span of time. */
function isTimeUnit(letter: string): letter is TimeUnit {
  return TIME_UNIT_LETTERS.some((unit) => unit === letter);
}

/** Splits `code` into its unit and count, or answers undefined when it is not shaped like a code. */
function codePartsOf(code: string): CodeParts | undefined {
  const match = CODE_SHAPE.exec(code);
  if (match === null) {
    return undefined;
  }
  const [, unit, digits] = match;
  const count = Number(digits);
  if (unit === 'T') {
    return { code, kind: 'ticks', count };
  }
  if (unit === 'S') {
    return { code, kind: 'seconds', count };
  }
  return isTimeUnit(unit) ? { code, kind: 'time', unit, count } : undefined;
}

/** The native counts of each unit, largest first, so the first divisor found is the base. */
function nativeCountsByUnit(): Map<TimeUnit, number[]> {
  const counts = new Map<TimeUnit, number[]>();
  for (const { wire } of timeframeOptions) {
    const parts = codePartsOf(wire);
    if (parts === undefined || parts.kind !== 'time') {
      continue;
    }
    const unitCounts = counts.get(parts.unit) ?? [];
    unitCounts.push(parts.count);
    counts.set(parts.unit, unitCounts);
  }
  for (const unitCounts of counts.values()) {
    unitCounts.sort((first, second) => second - first);
  }
  return counts;
}

const NATIVE_COUNTS: ReadonlyMap<TimeUnit, readonly number[]> = nativeCountsByUnit();

/** The largest native timeframe of `unit` whose count divides `count`: `M90` → `M30`, `H5` → `H1`. */
function aggregateBaseOf(unit: TimeUnit, count: number): string | undefined {
  const divisor = NATIVE_COUNTS.get(unit)?.find((candidate) => count % candidate === 0);
  return divisor === undefined ? undefined : `${unit}${divisor}`;
}

/** The aggregated interval of `count` of `unit`, when its cap allows it and a native timeframe divides it. */
function aggregatedIntervalOf(unit: TimeUnit, code: string, count: number): ChartInterval | undefined {
  if (count > TIME_UNIT_MAX_COUNTS[unit]) {
    return undefined;
  }
  const base = aggregateBaseOf(unit, count);
  if (base === undefined) {
    return undefined;
  }
  return { kind: 'aggregated', code, unit, count, base };
}

/** The interval `code` names, or undefined for a code outside the model, a zero and a count past its cap. */
export function chartIntervalOf(code: string): ChartInterval | undefined {
  const parts = codePartsOf(code);
  if (parts === undefined) {
    return undefined;
  }
  if (parts.kind === 'ticks') {
    return parts.count > MAX_TICKS_PER_BAR ? undefined : { kind: 'ticks', code, ticksPerBar: parts.count };
  }
  if (parts.kind === 'seconds') {
    return parts.count > MAX_SECONDS_PER_BAR ? undefined : { kind: 'seconds', code, seconds: parts.count };
  }
  if (NATIVE_TIMEFRAME_CODES.has(code)) {
    return { kind: 'native', code };
  }
  return aggregatedIntervalOf(parts.unit, code, parts.count);
}

/**
 * Whether the app can draw `code` today: MT5's native bars, and the N-tick and
 * N-second bars it builds itself from the symbol's raw ticks.
 */
export function isDrawableInterval(code: string): boolean {
  const kind = chartIntervalOf(code)?.kind;
  return kind === 'native' || kind === 'ticks' || kind === 'seconds';
}

/** `1 tick`, `10 ticks`: a count and the singular word of what it counts. */
function countedName(count: number, unitName: string): string {
  return `${count} ${unitName}${count === 1 ? '' : 's'}`;
}

/** The short label of a bar of `code`: `T37` → `37T`, `S5` → `5s`, `M7` → `7m`, `MN4` → `4M`. */
export function chartIntervalLabel(code: string): string {
  const interval = chartIntervalOf(code);
  if (interval?.kind === 'ticks') {
    return `${interval.ticksPerBar}T`;
  }
  if (interval?.kind === 'seconds') {
    return `${interval.seconds}s`;
  }
  return timeframeLabel(code);
}

/** The long label of a bar of `code`: `T37` → `37 ticks`, `S5` → `5 seconds`, `M7` → `7 minutes`. */
export function chartIntervalLongLabel(code: string): string {
  const interval = chartIntervalOf(code);
  if (interval?.kind === 'ticks') {
    return countedName(interval.ticksPerBar, 'tick');
  }
  if (interval?.kind === 'seconds') {
    return countedName(interval.seconds, 'second');
  }
  return timeframeLongLabel(code);
}

/** A unit letter a typed input can name: a time unit, or the ticks and seconds the app builds itself. */
type CodeUnit = TimeUnit | 'T' | 'S';

/** The units a typed suffix names; case is read before this lookup, so `M` here is months. */
const SUFFIX_UNITS = new Map<string, CodeUnit>([
  ['T', 'T'],
  ['S', 'S'],
  ['H', 'H'],
  ['D', 'D'],
  ['W', 'W'],
  ['M', 'MN'],
]);

/** The units a typed prefix names, so a canonical code typed as such is read back: `H4`, `MN1`, `T37`. */
const PREFIX_UNITS = new Map<string, CodeUnit>([
  ['T', 'T'],
  ['S', 'S'],
  ['M', 'M'],
  ['H', 'H'],
  ['D', 'D'],
  ['W', 'W'],
  ['MN', 'MN'],
]);

/** `m` after a count means minutes; every other suffix means its uppercase unit. */
function unitOfSuffix(suffix: string): CodeUnit | undefined {
  return suffix === 'm' ? 'M' : SUFFIX_UNITS.get(suffix.toUpperCase());
}

/** The unit a prefix names, whatever its case; `M` is minutes and `MN` months. */
function unitOfPrefix(prefix: string): CodeUnit | undefined {
  return PREFIX_UNITS.get(prefix.toUpperCase());
}

/** A bare count, which counts minutes: `7` is `7m`. */
const BARE_COUNT = /^([0-9]+)$/;

/** A count and then its unit: `37T`, `5s`, `4M`. */
const COUNT_FIRST = /^([0-9]+)([A-Za-z])$/;

/** A unit and then its count: `H4`, `MN1`, `T37`. */
const UNIT_FIRST = /^([A-Za-z]{1,2})([0-9]+)$/;

/** A unit and a count the text names, before the model decides whether it may exist. */
interface TypedCount {
  readonly unit: CodeUnit;
  readonly count: number;
}

/** The unit and count `input` names, or undefined when it names neither shape. */
function typedCountOf(input: string): TypedCount | undefined {
  const bareCount = BARE_COUNT.exec(input);
  if (bareCount !== null) {
    return { unit: 'M', count: Number(bareCount[1]) };
  }
  const countFirst = COUNT_FIRST.exec(input);
  if (countFirst !== null) {
    const unit = unitOfSuffix(countFirst[2]);
    return unit === undefined ? undefined : { unit, count: Number(countFirst[1]) };
  }
  const unitFirst = UNIT_FIRST.exec(input);
  if (unitFirst !== null) {
    const unit = unitOfPrefix(unitFirst[1]);
    return unit === undefined ? undefined : { unit, count: Number(unitFirst[2]) };
  }
  return undefined;
}

/** What the interval input shows when the text names no interval at all. */
export const INTERVAL_UNREADABLE_MESSAGE = 'Type an interval like 37T, 5s, 7m or 4M.';

/** What the interval input shows when the text names a count the chart cannot draw. */
export const INTERVAL_OUT_OF_RANGE_MESSAGE = 'That interval is outside the supported range.';

/** The interval the user's text names, or the short message the input shows instead. */
export type IntervalParseResult =
  { readonly ok: true; readonly interval: ChartInterval } | { readonly ok: false; readonly message: string };

/** Reads the interval input's text into the interval it names, or says briefly why it names none. */
export function parseIntervalInput(text: string): IntervalParseResult {
  const typed = typedCountOf(text.trim());
  if (typed === undefined) {
    return { ok: false, message: INTERVAL_UNREADABLE_MESSAGE };
  }
  const interval = chartIntervalOf(`${typed.unit}${typed.count}`);
  if (interval === undefined) {
    return { ok: false, message: INTERVAL_OUT_OF_RANGE_MESSAGE };
  }
  return { ok: true, interval };
}
