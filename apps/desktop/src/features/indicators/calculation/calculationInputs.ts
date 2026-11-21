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

/** One tick calculation timeframe: the choice's stored value, its label and the ticks one bar of it groups. */
export interface TickChoice {
  readonly value: string;
  readonly label: string;
  readonly ticksPerBar: number;
}

/** The choice that calculates on the chart's own bars, which the drop-down lists first. */
const CHART_CHOICE: SettingInputEnumOption = { value: CHART_TIMEFRAME_CHOICE, title: 'Chart' };

/** The tick timeframes the drop-down lists, which calculate on bars built from the chart's raw ticks. */
const TICK_CHOICES: readonly TickChoice[] = [
  { value: 'tick1', label: '1 tick', ticksPerBar: 1 },
  { value: 'tick10', label: '10 ticks', ticksPerBar: 10 },
  { value: 'tick100', label: '100 ticks', ticksPerBar: 100 },
  { value: 'tick1000', label: '1000 ticks', ticksPerBar: 1000 },
];

/** One choice per MT5 timeframe, in the order the platform lists them. */
const TIMEFRAME_CHOICES: readonly SettingInputEnumOption[] = timeframeOptions.map(({ wire, label }) => ({
  value: wire,
  title: label,
}));

/** The tick choice a stored value names, or undefined for the chart's own bars and every MT5 timeframe. */
export function tickChoiceOf(value: unknown): TickChoice | undefined {
  return TICK_CHOICES.find((choice) => choice.value === value);
}

/** The tick timeframes as the drop-down lists them. */
function tickOptions(): readonly SettingInputEnumOption[] {
  return TICK_CHOICES.map(({ value, label }) => ({ value, title: label }));
}

/** Every timeframe the drop-down lists: the chart's own bars, then the tick timeframes, then every MT5 timeframe. */
export function calculationTimeframeChoices(): readonly SettingInputEnumOption[] {
  return [CHART_CHOICE, ...tickOptions(), ...TIMEFRAME_CHOICES];
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
