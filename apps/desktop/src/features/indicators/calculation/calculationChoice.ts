import { timeframeLabel, timeframeOptions, timeframeSeconds } from '../../../shared/bridge/timeframes';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { CALCULATION_TIMEFRAME_INPUT, WAIT_FOR_CLOSES_INPUT } from './calculationInputs';

const TIMEFRAME_WIRES: ReadonlySet<string> = new Set(timeframeOptions.map(({ wire }) => wire));

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
 * The timeframe an indicator must be calculated on for `settings` on a chart of `chartTimeframe`, or undefined
 * to calculate on the chart's own bars: the chart choice, the tick choices, the chart's own timeframe and a
 * value the drop-down does not list all name no other bars.
 */
export function calculationTimeframeFor(settings: SettingValues, chartTimeframe: string): string | undefined {
  const chosen = chosenTimeframe(settings);
  if (chosen === undefined || chosen === chartTimeframe) {
    return undefined;
  }
  return chosen;
}

/** Whether `timeframe`'s bars are longer than `chartTimeframe`'s. */
export function isHigherTimeframe(timeframe: string, chartTimeframe: string): boolean {
  return timeframeSeconds(timeframe) > timeframeSeconds(chartTimeframe);
}

/** Whether a chart bar keeps the value of the last closed calculation bar: on unless switched off. */
export function waitsForTimeframeCloses(settings: SettingValues): boolean {
  return settings[WAIT_FOR_CLOSES_INPUT] !== false;
}

/** The word the calculation timeframe adds to a legend, e.g. "1H"; undefined while it uses the chart's bars. */
export function calculationTimeframeWord(settings: SettingValues): string | undefined {
  const chosen = chosenTimeframe(settings);
  return chosen === undefined ? undefined : timeframeLabel(chosen);
}
