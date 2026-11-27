/**
 * Everything the interval selector offers: the MT5 timeframes of
 * `config/timeframes.json` (see `timeframes.ts`) plus the tick-built intervals
 * this app builds itself from the chart symbol's raw ticks.
 *
 * A tick or seconds code (`T10`, `S5`) is frontend-only and never reaches the EA:
 * no MT5 series carries it, so the bridge is asked for ticks instead of a history
 * window. Which codes exist, and what each one needs, is `chartIntervalModel.ts`;
 * any tick count it allows is a tick interval here, while the menu lists the four
 * presets below.
 */
import { chartIntervalLabel, chartIntervalLongLabel, chartIntervalOf } from './chartIntervalModel';
import { timeframeSection, type TimeframeSection } from './timeframes';

/**
 * How the bars of an interval are grouped from the symbol's raw ticks: a count of
 * ticks (`T10`) or a block of seconds (`S5`). Either kind is built by this app, so
 * no MT5 series carries it.
 */
export type TickGrouping =
  { readonly kind: 'ticks'; readonly ticksPerBar: number } | { readonly kind: 'seconds'; readonly seconds: number };

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

/** The tick counts the interval menu offers; the model recognises every count up to its own cap. */
const TICK_PRESET_COUNTS: readonly number[] = [1, 10, 100, 1000];

/** The presets, labelled by the model so a preset and a typed tick code can never read differently. */
export const TICK_INTERVALS: readonly TickInterval[] = TICK_PRESET_COUNTS.map((ticksPerBar) => {
  const code = `T${ticksPerBar}`;
  return { code, ticksPerBar, label: chartIntervalLabel(code), longLabel: chartIntervalLongLabel(code) };
});

/**
 * The grouping the bars of `code` are built from, or undefined for a timeframe, an
 * aggregated interval and a code the interval model does not know.
 */
export function tickGroupingOf(code: string | undefined): TickGrouping | undefined {
  if (code === undefined) {
    return undefined;
  }
  const interval = chartIntervalOf(code);
  if (interval?.kind === 'ticks') {
    return { kind: 'ticks', ticksPerBar: interval.ticksPerBar };
  }
  return interval?.kind === 'seconds' ? { kind: 'seconds', seconds: interval.seconds } : undefined;
}

/**
 * Whether `code` names an interval this app builds from the chart symbol's raw
 * ticks: an N-tick or an N-second one, which no MT5 series carries.
 */
export function isTickBuiltInterval(code: string | undefined): boolean {
  return tickGroupingOf(code) !== undefined;
}

/**
 * The ticks the bars of `code` group, or undefined for a timeframe, a seconds or an
 * aggregated interval, and for a code the interval model does not know.
 */
export function ticksPerBarOf(code: string | undefined): number | undefined {
  const grouping = tickGroupingOf(code);
  return grouping?.kind === 'ticks' ? grouping.ticksPerBar : undefined;
}

/** Whether `code` names an interval whose bars group a number of ticks. */
export function isTickInterval(code: string | undefined): boolean {
  return ticksPerBarOf(code) !== undefined;
}

/** The seconds the bars of `code` span, or undefined for a code that is no seconds interval. */
export function secondsPerBarOf(code: string | undefined): number | undefined {
  const grouping = tickGroupingOf(code);
  return grouping?.kind === 'seconds' ? grouping.seconds : undefined;
}

/** `T10` → `10T`, `T37` → `37T`; an MT5 code keeps its own short label. */
export function intervalLabel(code: string): string {
  return chartIntervalLabel(code);
}

/** `T10` → `10 ticks`, `T37` → `37 ticks`; an MT5 code keeps its own long label. */
export function intervalLongLabel(code: string): string {
  return chartIntervalLongLabel(code);
}

/** The menu groups ticks in a section of their own, listed before the MT5 ones. */
export type IntervalSection = 'ticks' | TimeframeSection;

export function intervalSection(code: string): IntervalSection {
  return isTickInterval(code) ? 'ticks' : timeframeSection(code);
}
