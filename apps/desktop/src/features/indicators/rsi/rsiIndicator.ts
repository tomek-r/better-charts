import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type {
  IndicatorFill,
  IndicatorFrame,
  IndicatorLevel,
  IndicatorPlot,
} from '../../chart/engine/indicators/indicatorFrame';
import { sourceValue } from '../../chart/engine/indicators/indicatorSource';
import type { SettingInputSource, SettingValues } from '../../chart/engine/settings/settingInputs';
import { settingStyleKey } from '../../chart/engine/settings/settingStyles';
import { BarByBarIndicator } from '../barByBarIndicator';
import { resolveWindowSettings, type WindowSettings } from '../closedValueWindow';
import { booleanSetting, levelSetting, linePlotSetting, stringSetting } from '../indicatorSettingValues';

export const PLOT_STYLE = 'plot';
export const UPPER_BAND_STYLE = 'upperBand';
export const MIDDLE_BAND_STYLE = 'middleBand';
export const LOWER_BAND_STYLE = 'lowerBand';
export const BACKGROUND_STYLE = 'background';
export const DEFAULT_LENGTH = 14;
export const DEFAULT_SOURCE: SettingInputSource = 'close';
export const DEFAULT_COLOR = '#7E57C2';
export const DEFAULT_BAND_COLOR = '#787B86';
export const DEFAULT_MIDDLE_BAND_COLOR = '#787B8680';
export const DEFAULT_BACKGROUND_COLOR = '#7E57C21A';
export const UPPER_BAND = 70;
export const MIDDLE_BAND = 50;
export const LOWER_BAND = 30;
export const RSI_PRECISION = 2;

const PLOT_TITLE = 'RSI';
const UPPER_BAND_TITLE = 'Upper Band';
const MIDDLE_BAND_TITLE = 'Middle Band';
const LOWER_BAND_TITLE = 'Lower Band';
const UPPER_LEVEL_INDEX = 0;
const LOWER_LEVEL_INDEX = 2;
const PLOT_WIDTH = 1;
const DEFAULT_WINDOW_SETTINGS: WindowSettings = { length: DEFAULT_LENGTH, source: DEFAULT_SOURCE };

/** What the next change is measured from, and the averages the first `length` changes build. */
interface RsiState {
  previousSource: number | null;
  changeCount: number;
  gainSum: number;
  lossSum: number;
  gainAverage: number | null;
  lossAverage: number | null;
}

const INITIAL_STATE: RsiState = {
  previousSource: null,
  changeCount: 0,
  gainSum: 0,
  lossSum: 0,
  gainAverage: null,
  lossAverage: null,
};

/** Pine's `ta.rma` step: the first value averages the first `length` values, then the mean leans back. */
function rmaStep(previousAverage: number, value: number, length: number): number {
  return (previousAverage * (length - 1) + value) / length;
}

/** Pine's `ta.rsi` of its two averages: no fall reads 100 and no rise reads 0. */
function rsiFrom(gainAverage: number, lossAverage: number): number {
  if (lossAverage === 0) {
    return 100;
  }
  if (gainAverage === 0) {
    return 0;
  }
  return 100 - 100 / (1 + gainAverage / lossAverage);
}

/** The state once a change of a closed bar joins it: the seed sums fill up, then the two RMAs move on. */
function stateAfterChange(state: RsiState, change: number, length: number): RsiState {
  const gain = Math.max(change, 0);
  const loss = Math.max(-change, 0);
  if (state.gainAverage !== null && state.lossAverage !== null) {
    const gainAverage = rmaStep(state.gainAverage, gain, length);
    const lossAverage = rmaStep(state.lossAverage, loss, length);
    return { ...state, gainAverage, lossAverage };
  }
  const gainSum = state.gainSum + gain;
  const lossSum = state.lossSum + loss;
  const changeCount = state.changeCount + 1;
  if (changeCount < length) {
    return { ...state, gainSum, lossSum, changeCount };
  }
  return { ...state, gainSum, lossSum, changeCount, gainAverage: gainSum / length, lossAverage: lossSum / length };
}

/** The RSI a change gives, or nothing while the first `length` changes are still being collected. */
function rsiAfterChange(state: RsiState, change: number, length: number): number | null {
  const nextState = stateAfterChange(state, change, length);
  if (nextState.gainAverage === null || nextState.lossAverage === null) {
    return null;
  }
  return rsiFrom(nextState.gainAverage, nextState.lossAverage);
}

/** A band's own values, before its style is read. */
interface BandDefaults {
  title: string;
  price: number;
  color: string;
  width: number;
}

/** A band level at `price`, drawn in `color` at the width of the RSI line. */
function bandLevel(title: string, price: number, color: string): BandDefaults {
  return { title, price, color, width: PLOT_WIDTH };
}

function resolvePlots(settings: SettingValues): IndicatorPlot[] {
  return [linePlotSetting(settings, PLOT_STYLE, { title: PLOT_TITLE, color: DEFAULT_COLOR, width: PLOT_WIDTH })];
}

function resolveLevels(settings: SettingValues): IndicatorLevel[] {
  return [
    levelSetting(settings, UPPER_BAND_STYLE, bandLevel(UPPER_BAND_TITLE, UPPER_BAND, DEFAULT_BAND_COLOR)),
    levelSetting(settings, MIDDLE_BAND_STYLE, bandLevel(MIDDLE_BAND_TITLE, MIDDLE_BAND, DEFAULT_MIDDLE_BAND_COLOR)),
    levelSetting(settings, LOWER_BAND_STYLE, bandLevel(LOWER_BAND_TITLE, LOWER_BAND, DEFAULT_BAND_COLOR)),
  ];
}

/** The band between the upper and the lower band, unless the Background style switches it off. */
function resolveFills(settings: SettingValues): IndicatorFill[] {
  if (!booleanSetting(settings, settingStyleKey(BACKGROUND_STYLE, 'visible'), true)) {
    return [];
  }
  return [
    {
      from: { kind: 'level', index: UPPER_LEVEL_INDEX },
      to: { kind: 'level', index: LOWER_LEVEL_INDEX },
      color: stringSetting(settings, settingStyleKey(BACKGROUND_STYLE, 'color'), DEFAULT_BACKGROUND_COLOR),
    },
  ];
}

/**
 * Pine's `ta.rsi`: the rises and the falls of the source are averaged apart by `ta.rma`, and the
 * ratio of the two averages gives the value. The state stays as of the last closed bar, so a tick
 * measures the bar it redraws without changing what the next bar starts from.
 */
export class RsiIndicator extends BarByBarIndicator {
  private length = DEFAULT_LENGTH;
  private source: SettingInputSource = DEFAULT_SOURCE;
  private state: RsiState = INITIAL_STATE;

  protected reset(settings: SettingValues): void {
    const { length, source } = resolveWindowSettings(settings, DEFAULT_WINDOW_SETTINGS);
    this.length = length;
    this.source = source;
    this.state = INITIAL_STATE;
  }

  /** The RSI of a bar, or nothing for the bar that opens the series and while the seed fills up. */
  protected valuesAt(bar: RenderBar): readonly (number | null)[] {
    const change = this.changeAt(bar);
    return [change === null ? null : rsiAfterChange(this.state, change, this.length)];
  }

  /** Moves the state on to a bar that closed, so the next change starts from its source value. */
  protected commit(bar: RenderBar): void {
    const change = this.changeAt(bar);
    const movedState = change === null ? this.state : stateAfterChange(this.state, change, this.length);
    this.state = { ...movedState, previousSource: sourceValue(bar, this.source) };
  }

  /** The way the RSI is drawn, which no bar changes: one line, three bands and the fill between them. */
  protected frameStyle(settings: SettingValues): Omit<IndicatorFrame, 'bars'> {
    return {
      plots: resolvePlots(settings),
      levels: resolveLevels(settings),
      fills: resolveFills(settings),
      precision: RSI_PRECISION,
    };
  }

  /** The change of a bar against the last closed source value, or nothing for the first bar. */
  private changeAt(bar: RenderBar): number | null {
    if (this.state.previousSource === null) {
      return null;
    }
    return sourceValue(bar, this.source) - this.state.previousSource;
  }
}
