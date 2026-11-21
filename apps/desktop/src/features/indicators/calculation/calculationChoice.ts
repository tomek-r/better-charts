import { timeframeLabel, timeframeOptions, timeframeSeconds } from '../../../shared/bridge/timeframes';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { CALCULATION_TIMEFRAME_INPUT, WAIT_FOR_CLOSES_INPUT, tickChoiceOf } from './calculationInputs';

const TIMEFRAME_WIRES: ReadonlySet<string> = new Set(timeframeOptions.map(({ wire }) => wire));

/** A calculation on another timeframe's bars, or on bars built from the chart's raw ticks. */
export type OffChartCalculation =
  | { readonly kind: 'timeframe'; readonly timeframe: string }
  | { readonly kind: 'ticks'; readonly ticksPerBar: number; readonly label: string };

/** A calculation on bars built from the chart's raw ticks, which one bar groups `ticksPerBar` of. */
export type TickCalculationMode = Extract<OffChartCalculation, { kind: 'ticks' }>;

/** What an indicator's settings say it is calculated on. */
export type CalculationMode = { readonly kind: 'chart' } | OffChartCalculation;

/**
 * The timeframe `settings` name for the calculation, or undefined while they calculate on the chart's own
 * bars: the chart choice and the tick choices name no timeframe of their own, and neither does a value the
 * drop-down does not list.
 */
function chosenTimeframe(settings: SettingValues): string | undefined {
  const choice = settings[CALCULATION_TIMEFRAME_INPUT];
  return typeof choice === 'string' && TIMEFRAME_WIRES.has(choice) ? choice : undefined;
}

/**
 * The calculation `settings` ask for on a chart of `chartTimeframe`: another timeframe's bars, N-tick bars, or
 * the chart's own bars — which is what the chart choice, the chart's own timeframe and a value the drop-down
 * does not list all name.
 */
export function calculationModeOf(settings: SettingValues, chartTimeframe: string): CalculationMode {
  const tick = tickChoiceOf(settings[CALCULATION_TIMEFRAME_INPUT]);
  if (tick !== undefined) {
    return { kind: 'ticks', ticksPerBar: tick.ticksPerBar, label: tick.label };
  }
  const timeframe = chosenTimeframe(settings);
  if (timeframe === undefined || timeframe === chartTimeframe) {
    return { kind: 'chart' };
  }
  return { kind: 'timeframe', timeframe };
}

/** Whether `timeframe`'s bars are longer than `chartTimeframe`'s. */
export function isHigherTimeframe(timeframe: string, chartTimeframe: string): boolean {
  return timeframeSeconds(timeframe) > timeframeSeconds(chartTimeframe);
}

/** Whether a chart bar keeps the value of the last closed calculation bar: on unless switched off. */
export function waitsForTimeframeCloses(settings: SettingValues): boolean {
  return settings[WAIT_FOR_CLOSES_INPUT] !== false;
}

/** The word the calculation adds to a legend, e.g. "1H" or "10 ticks"; undefined while it uses the chart's bars. */
export function calculationTimeframeWord(settings: SettingValues): string | undefined {
  const tick = tickChoiceOf(settings[CALCULATION_TIMEFRAME_INPUT]);
  if (tick !== undefined) {
    return tick.label;
  }
  const chosen = chosenTimeframe(settings);
  return chosen === undefined ? undefined : timeframeLabel(chosen);
}
