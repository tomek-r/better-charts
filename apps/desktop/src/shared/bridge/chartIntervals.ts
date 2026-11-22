/**
 * Everything the interval selector offers: the MT5 timeframes of
 * `config/timeframes.json` (see `timeframes.ts`) plus the tick-based intervals
 * this app builds itself from the chart symbol's raw ticks.
 *
 * A tick code (`T10`) is frontend-only and never reaches the EA: no MT5 series
 * carries it, so the bridge is asked for ticks instead of a history window.
 */
import { timeframeLabel, timeframeLongLabel, timeframeSection, type TimeframeSection } from './timeframes';

/** Bars of N ticks, listed as TradingView lists them: 1T, 10T, 100T, 1000T. */
export interface TickInterval {
  /** The code the selector stores and compares; it is never sent to the bridge. */
  readonly code: string;
  /** The ticks one bar groups. */
  readonly ticksPerBar: number;
  /** Label of the interval's button: `10T`. */
  readonly label: string;
  /** Label of the interval's menu row: `10 ticks`. */
  readonly longLabel: string;
}

export const TICK_INTERVALS: readonly TickInterval[] = [
  { code: 'T1', ticksPerBar: 1, label: '1T', longLabel: '1 tick' },
  { code: 'T10', ticksPerBar: 10, label: '10T', longLabel: '10 ticks' },
  { code: 'T100', ticksPerBar: 100, label: '100T', longLabel: '100 ticks' },
  { code: 'T1000', ticksPerBar: 1000, label: '1000T', longLabel: '1000 ticks' },
];

const tickIntervalByCode = new Map<string, TickInterval>(TICK_INTERVALS.map((interval) => [interval.code, interval]));

/** The ticks the bars of `code` group, or undefined for an MT5 timeframe or an unknown code. */
export function ticksPerBarOf(code: string | undefined): number | undefined {
  return code === undefined ? undefined : tickIntervalByCode.get(code)?.ticksPerBar;
}

/** Whether `code` names an interval this app builds from ticks. */
export function isTickInterval(code: string | undefined): boolean {
  return ticksPerBarOf(code) !== undefined;
}

/** `T10` → `10T`; an MT5 code keeps its own short label. */
export function intervalLabel(code: string): string {
  return tickIntervalByCode.get(code)?.label ?? timeframeLabel(code);
}

/** `T10` → `10 ticks`; an MT5 code keeps its own long label. */
export function intervalLongLabel(code: string): string {
  return tickIntervalByCode.get(code)?.longLabel ?? timeframeLongLabel(code);
}

/** The menu groups ticks in a section of their own, listed before the MT5 ones. */
export type IntervalSection = 'ticks' | TimeframeSection;

export function intervalSection(code: string): IntervalSection {
  return isTickInterval(code) ? 'ticks' : timeframeSection(code);
}
