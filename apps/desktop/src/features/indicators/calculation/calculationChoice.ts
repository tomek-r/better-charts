import { timeframeLabel, timeframeOptions, timeframeSeconds } from '../../../shared/bridge/timeframes';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { CALCULATION_TIMEFRAME_INPUT, WAIT_FOR_CLOSES_INPUT } from './calculationInputs';

const TIMEFRAME_WIRES: ReadonlySet<string> = new Set(timeframeOptions.map(({ wire }) => wire));

/**
 * The timeframe `settings` name for the calculation, or undefined while they calculate on the chart's own
 * bars: the chart choice and the tick choices name no bars to group, and neither does a value the drop-down
 * does not list.
 */
function chosenTimeframe(settings: SettingValues): string | undefined {
  const choice = settings[CALCULATION_TIMEFRAME_INPUT];
  return typeof choice === 'string' && TIMEFRAME_WIRES.has(choice) ? choice : undefined;
}

/**
 * The timeframe an indicator must be calculated on for `settings` on a chart of `chartTimeframe`, or undefined
 * to calculate on the chart's own bars — which is all that is possible for the chart's own timeframe and for a
 * shorter one, until those are grouped from bars finer than the chart holds.
 */
export function higherTimeframeFor(settings: SettingValues, chartTimeframe: string): string | undefined {
  const chosen = chosenTimeframe(settings);
  if (chosen === undefined) {
    return undefined;
  }
  return timeframeSeconds(chosen) > timeframeSeconds(chartTimeframe) ? chosen : undefined;
}

/** Whether a chart bar keeps the value of the last closed higher-timeframe bar: on unless switched off. */
export function waitsForTimeframeCloses(settings: SettingValues): boolean {
  return settings[WAIT_FOR_CLOSES_INPUT] !== false;
}

/** The word the calculation timeframe adds to a legend, e.g. "1H"; undefined while it uses the chart's bars. */
export function calculationTimeframeWord(settings: SettingValues): string | undefined {
  const chosen = chosenTimeframe(settings);
  return chosen === undefined ? undefined : timeframeLabel(chosen);
}
