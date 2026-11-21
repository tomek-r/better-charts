import { timeframeOptions, timeframeSeconds } from '../../../shared/bridge/timeframes';
import type {
  SettingInputBool,
  SettingInputDefinition,
  SettingInputEnum,
  SettingInputEnumOption,
} from '../../chart/engine/settings/settingInputs';

/** The fieldset the settings dialog draws the calculation inputs in, as TradingView's Calculation section. */
export const CALCULATION_GROUP = 'Calculation';

/** The stored id of the input naming the timeframe an indicator is calculated on. */
export const CALCULATION_TIMEFRAME_INPUT = 'calculationTimeframe';

/** The stored id of the input saying whether a chart bar waits for a higher-timeframe bar to close. */
export const WAIT_FOR_CLOSES_INPUT = 'waitForTimeframeCloses';

/** The choice that calculates on the chart's own bars, which is what every indicator did before this setting. */
export const CHART_TIMEFRAME_CHOICE = 'chart';

/** The help the timeframe drop-down carries, which the info mark beside it shows. */
export const CALCULATION_TIMEFRAME_TOOLTIP =
  'The timeframe this indicator is calculated on. A higher timeframe is built from the bars the chart holds.';

const TICKS_REASON = 'Needs tick data — coming next';
const LOWER_REASON = "Lower than the chart's timeframe — coming next";

/** The choice that calculates on the chart's own bars, which the drop-down lists first. */
const CHART_CHOICE: SettingInputEnumOption = { value: CHART_TIMEFRAME_CHOICE, title: 'Chart' };

/** The tick timeframes the drop-down lists but cannot calculate yet. */
const TICK_CHOICES: readonly SettingInputEnumOption[] = [
  { value: 'tick1', title: '1 tick', disabledReason: TICKS_REASON },
  { value: 'tick10', title: '10 ticks', disabledReason: TICKS_REASON },
  { value: 'tick100', title: '100 ticks', disabledReason: TICKS_REASON },
  { value: 'tick1000', title: '1000 ticks', disabledReason: TICKS_REASON },
];

/** The reason a timeframe shorter than the chart's is out of reach yet; nothing while that is unknown. */
function lowerTimeframeReason(seconds: number, chartSeconds: number | undefined): { disabledReason?: string } {
  return chartSeconds !== undefined && seconds < chartSeconds ? { disabledReason: LOWER_REASON } : {};
}

/** One choice per MT5 timeframe, in the order the platform lists them, disabled below the chart's own. */
function timeframeChoices(chartSeconds: number | undefined): SettingInputEnumOption[] {
  return timeframeOptions.map(({ wire, label, seconds }) => ({
    value: wire,
    title: label,
    ...lowerTimeframeReason(seconds, chartSeconds),
  }));
}

/**
 * Every timeframe the drop-down lists: the chart's own bars, then the tick timeframes, then every MT5
 * timeframe by its label. A chart of `chartTimeframe` disables the choices it cannot calculate yet; a chart
 * whose timeframe is not known yet disables none of them.
 */
export function calculationTimeframeChoices(chartTimeframe: string | undefined): readonly SettingInputEnumOption[] {
  const chartSeconds = chartTimeframe === undefined ? undefined : timeframeSeconds(chartTimeframe);
  return [CHART_CHOICE, ...TICK_CHOICES, ...timeframeChoices(chartSeconds)];
}

/** The timeframe input, whose choices the dialog rebuilds for the chart it is open on. */
function calculationTimeframeInput(): SettingInputEnum {
  return {
    kind: 'enum',
    id: CALCULATION_TIMEFRAME_INPUT,
    title: 'Timeframe',
    group: CALCULATION_GROUP,
    tooltip: CALCULATION_TIMEFRAME_TOOLTIP,
    defaultValue: CHART_TIMEFRAME_CHOICE,
    options: calculationTimeframeChoices(undefined),
  };
}

/** Whether a chart bar keeps the last closed higher-timeframe bar's value, which is on until switched off. */
function waitForClosesInput(): SettingInputBool {
  return {
    kind: 'bool',
    id: WAIT_FOR_CLOSES_INPUT,
    title: 'Wait for timeframe closes',
    group: CALCULATION_GROUP,
    defaultValue: true,
  };
}

/** The Calculation section's two inputs, which every built-in indicator carries after its own. */
export function calculationInputs(): readonly SettingInputDefinition[] {
  return [calculationTimeframeInput(), waitForClosesInput()];
}

/** The inputs with the timeframe choices a chart of `chartTimeframe` can offer, the others left as they are. */
export function calculationInputsForChart(
  inputs: readonly SettingInputDefinition[],
  chartTimeframe: string | undefined,
): readonly SettingInputDefinition[] {
  const choices = calculationTimeframeChoices(chartTimeframe);
  return inputs.map((input) =>
    input.kind === 'enum' && input.id === CALCULATION_TIMEFRAME_INPUT ? { ...input, options: choices } : input,
  );
}
