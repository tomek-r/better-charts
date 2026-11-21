import { timeframeOptions } from '../../../shared/bridge/timeframes';
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

/** The stored id of the input saying whether a chart bar waits for a bar of the calculation timeframe to close. */
export const WAIT_FOR_CLOSES_INPUT = 'waitForTimeframeCloses';

/** The choice that calculates on the chart's own bars, which is what every indicator did before this setting. */
export const CHART_TIMEFRAME_CHOICE = 'chart';

/** The help the timeframe drop-down carries, which the info mark beside it shows. */
export const CALCULATION_TIMEFRAME_TOOLTIP =
  'The timeframe this indicator is calculated on. Another timeframe is read from the broker.';

const TICKS_REASON = 'Needs tick data — coming next';

/** The choice that calculates on the chart's own bars, which the drop-down lists first. */
const CHART_CHOICE: SettingInputEnumOption = { value: CHART_TIMEFRAME_CHOICE, title: 'Chart' };

/** The tick timeframes the drop-down lists but cannot calculate yet. */
const TICK_CHOICES: readonly SettingInputEnumOption[] = [
  { value: 'tick1', title: '1 tick', disabledReason: TICKS_REASON },
  { value: 'tick10', title: '10 ticks', disabledReason: TICKS_REASON },
  { value: 'tick100', title: '100 ticks', disabledReason: TICKS_REASON },
  { value: 'tick1000', title: '1000 ticks', disabledReason: TICKS_REASON },
];

/** One choice per MT5 timeframe, in the order the platform lists them. */
const TIMEFRAME_CHOICES: readonly SettingInputEnumOption[] = timeframeOptions.map(({ wire, label }) => ({
  value: wire,
  title: label,
}));

/** Every timeframe the drop-down lists: the chart's own bars, then the tick timeframes, then every MT5 timeframe. */
export function calculationTimeframeChoices(): readonly SettingInputEnumOption[] {
  return [CHART_CHOICE, ...TICK_CHOICES, ...TIMEFRAME_CHOICES];
}

/** The timeframe input, whose choices are the same on every chart. */
function calculationTimeframeInput(): SettingInputEnum {
  return {
    kind: 'enum',
    id: CALCULATION_TIMEFRAME_INPUT,
    title: 'Timeframe',
    group: CALCULATION_GROUP,
    tooltip: CALCULATION_TIMEFRAME_TOOLTIP,
    defaultValue: CHART_TIMEFRAME_CHOICE,
    options: calculationTimeframeChoices(),
  };
}

/** Whether a chart bar keeps the last closed bar's value of the calculation timeframe, on until switched off. */
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
