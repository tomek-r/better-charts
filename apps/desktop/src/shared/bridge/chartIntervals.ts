/**
 * Everything the interval selector offers: the MT5 timeframes of
 * `config/timeframes.json` (see `timeframes.ts`) plus the tick-built intervals
 * this app builds itself from the chart symbol's raw ticks.
 *
 * A tick or seconds code (`T10`, `S5`) is frontend-only and never reaches the EA:
 * no MT5 series carries it, so the bridge is asked for ticks instead of a history
 * window. An aggregated code (`M7`, `MN4`) never reaches it either: the chart asks
 * for its base timeframe and groups those candles itself. Which codes exist, and
 * what each one needs, is `chartIntervalModel.ts`; any tick count it allows is a
 * tick interval here, while the menu lists the four presets below.
 */
import {
  chartIntervalLabel,
  chartIntervalLongLabel,
  chartIntervalOf,
  MAX_TICKS_PER_BAR,
  type AggregatedInterval,
} from './chartIntervalModel';
import { timeframeSeconds, timeframeSection, type TimeframeSection } from './timeframes';

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

/** The aggregated interval `code` names, or undefined for every other code and an unknown one. */
export function aggregatedIntervalOf(code: string | undefined): AggregatedInterval | undefined {
  const interval = code === undefined ? undefined : chartIntervalOf(code);
  return interval?.kind === 'aggregated' ? interval : undefined;
}

/**
 * The native timeframe the bridge is asked for to draw `code`: the base timeframe an aggregated
 * interval is grouped from, and `code` itself for every interval MT5 serves as it is.
 */
export function seriesTimeframeOf(code: string): string {
  return aggregatedIntervalOf(code)?.base ?? code;
}

/**
 * The base bars a window of `bars` candles of `code` needs: an aggregated bar is `count` base bars
 * of its series, every other bar one of its own. The adapter clamps the result to its own bound.
 */
export function seriesBarsOf(code: string, bars: number): number {
  return bars * (aggregatedIntervalOf(code)?.count ?? 1);
}

/** A native series and the bars to ask it for. */
export interface SeriesRequest {
  timeframe: string;
  bars: number;
}

/** The native series and base-bar count the bridge is asked for to draw `bars` candles of `code`. */
export function seriesRequestOf(code: string, bars: number): SeriesRequest {
  return { timeframe: seriesTimeframeOf(code), bars: seriesBarsOf(code, bars) };
}

/** `T10` → `10T`, `T37` → `37T`; an MT5 code keeps its own short label. */
export function intervalLabel(code: string): string {
  return chartIntervalLabel(code);
}

/** `T10` → `10 ticks`, `T37` → `37 ticks`; an MT5 code keeps its own long label. */
export function intervalLongLabel(code: string): string {
  return chartIntervalLongLabel(code);
}

/** The menu lists ticks and seconds in sections of their own, before the MT5 timeframes. */
export type IntervalSection = 'ticks' | 'seconds' | TimeframeSection;

export function intervalSection(code: string): IntervalSection {
  if (isTickInterval(code)) {
    return 'ticks';
  }
  return chartIntervalOf(code)?.kind === 'seconds' ? 'seconds' : timeframeSection(code);
}

/**
 * Where an interval sorts in the menu: a tick interval first, ascending by its tick count, and every
 * other one after them, ascending by its own length. The offset keeps the ranges apart: a tick code
 * counts at most `MAX_TICKS_PER_BAR` ticks, so its key stays below the shortest time interval's seconds.
 */
export function intervalOrderKey(code: string): number {
  const ticksPerBar = ticksPerBarOf(code);
  return ticksPerBar === undefined ? timeframeSeconds(code) : ticksPerBar - MAX_TICKS_PER_BAR - 1;
}
