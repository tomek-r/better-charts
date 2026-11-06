import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { IndicatorFrame, IndicatorLevel, IndicatorPlot } from '../../chart/engine/indicators/indicatorFrame';
import { sourceValue } from '../../chart/engine/indicators/indicatorSource';
import type { SettingInputSource, SettingValues } from '../../chart/engine/settings/settingInputs';
import { settingStyleKey } from '../../chart/engine/settings/settingStyles';
import { BarByBarIndicator } from '../barByBarIndicator';
import { emaAfter, emaValue, INITIAL_EMA_STATE, type EmaState } from '../emaState';
import { SOURCE_INPUT } from '../indicatorInputs';
import {
  booleanSetting,
  colorSetting,
  levelSetting,
  linePlotSetting,
  numberSetting,
  sourceSetting,
} from '../indicatorSettingValues';

export const FAST_LENGTH_INPUT = 'fastLength';
export const SLOW_LENGTH_INPUT = 'slowLength';
export const SIGNAL_LENGTH_INPUT = 'signalLength';
export const HISTOGRAM_STYLE = 'histogram';
export const HISTOGRAM_ABOVE_GROW_STYLE = 'histogramAboveGrow';
export const HISTOGRAM_ABOVE_FALL_STYLE = 'histogramAboveFall';
export const HISTOGRAM_BELOW_GROW_STYLE = 'histogramBelowGrow';
export const HISTOGRAM_BELOW_FALL_STYLE = 'histogramBelowFall';
export const MACD_STYLE = 'macd';
export const SIGNAL_STYLE = 'signal';
export const ZERO_LINE_STYLE = 'zeroLine';
export const DEFAULT_FAST_LENGTH = 12;
export const DEFAULT_SLOW_LENGTH = 26;
export const DEFAULT_SIGNAL_LENGTH = 9;
export const DEFAULT_SOURCE: SettingInputSource = 'close';
export const DEFAULT_HISTOGRAM_ABOVE_GROW_COLOR = '#26A69A';
export const DEFAULT_HISTOGRAM_ABOVE_FALL_COLOR = '#B2DFDB';
export const DEFAULT_HISTOGRAM_BELOW_GROW_COLOR = '#FFCDD2';
export const DEFAULT_HISTOGRAM_BELOW_FALL_COLOR = '#FF5252';
export const DEFAULT_MACD_COLOR = '#2962FF';
export const DEFAULT_SIGNAL_COLOR = '#FF6D00';
export const DEFAULT_ZERO_LINE_COLOR = '#787B8680';
export const ZERO_LINE_PRICE = 0;

const HISTOGRAM_TITLE = 'Histogram';
const MACD_TITLE = 'MACD';
const SIGNAL_TITLE = 'Signal';
const ZERO_LINE_TITLE = 'Zero Line';
const DEFAULT_HISTOGRAM_VISIBLE = true;
const LINE_WIDTH = 1;

/** The four colours a histogram column can take: the sign picks a pair, the column picks the shade. */
interface HistogramColors {
  aboveGrow: string;
  aboveFall: string;
  belowGrow: string;
  belowFall: string;
}

/** The three values the MACD plots, before the styles are read. */
interface MacdValues {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

/** The state as of the last closed bar: the three averages it left and the histogram it ended on. */
interface MacdState {
  fast: EmaState;
  slow: EmaState;
  signal: EmaState;
  histogram: number | null;
}

/** The values a bar was read as, and the state they were read from, so one bar is computed once. */
interface ComputedMacd {
  readonly bar: RenderBar;
  readonly state: MacdState;
  readonly values: MacdValues;
}

const DEFAULT_HISTOGRAM_COLORS: HistogramColors = {
  aboveGrow: DEFAULT_HISTOGRAM_ABOVE_GROW_COLOR,
  aboveFall: DEFAULT_HISTOGRAM_ABOVE_FALL_COLOR,
  belowGrow: DEFAULT_HISTOGRAM_BELOW_GROW_COLOR,
  belowFall: DEFAULT_HISTOGRAM_BELOW_FALL_COLOR,
};

const INITIAL_STATE: MacdState = {
  fast: INITIAL_EMA_STATE,
  slow: INITIAL_EMA_STATE,
  signal: INITIAL_EMA_STATE,
  histogram: null,
};

/**
 * TradingView's column colour: the sign of the histogram picks the pair and the last closed column
 * picks the shade, which falls back to a Fall shade because a column without one has not grown.
 */
function histogramColor(
  histogram: number | null,
  previousHistogram: number | null,
  colors: HistogramColors,
): string | null {
  if (histogram === null) {
    return null;
  }
  const grew = previousHistogram !== null && previousHistogram < histogram;
  if (histogram >= 0) {
    return grew ? colors.aboveGrow : colors.aboveFall;
  }
  return grew ? colors.belowGrow : colors.belowFall;
}

/** The four column colours as the settings store them. */
function resolveColors(settings: SettingValues): HistogramColors {
  return {
    aboveGrow: colorSetting(settings, HISTOGRAM_ABOVE_GROW_STYLE, DEFAULT_HISTOGRAM_ABOVE_GROW_COLOR),
    aboveFall: colorSetting(settings, HISTOGRAM_ABOVE_FALL_STYLE, DEFAULT_HISTOGRAM_ABOVE_FALL_COLOR),
    belowGrow: colorSetting(settings, HISTOGRAM_BELOW_GROW_STYLE, DEFAULT_HISTOGRAM_BELOW_GROW_COLOR),
    belowFall: colorSetting(settings, HISTOGRAM_BELOW_FALL_STYLE, DEFAULT_HISTOGRAM_BELOW_FALL_COLOR),
  };
}

/** The columns, drawn in the Above Grow colour and switched off by the histogram's own toggle. */
function histogramPlot(settings: SettingValues, colors: HistogramColors): IndicatorPlot {
  return {
    title: HISTOGRAM_TITLE,
    style: 'histogram',
    color: colors.aboveGrow,
    lineWidth: LINE_WIDTH,
    visible: booleanSetting(settings, settingStyleKey(HISTOGRAM_STYLE, 'visible'), DEFAULT_HISTOGRAM_VISIBLE),
  };
}

/** The columns first, so the levels hang on the MACD line, then the two lines. */
function resolvePlots(settings: SettingValues, colors: HistogramColors): IndicatorPlot[] {
  return [
    histogramPlot(settings, colors),
    linePlotSetting(settings, MACD_STYLE, { title: MACD_TITLE, color: DEFAULT_MACD_COLOR, width: LINE_WIDTH }),
    linePlotSetting(settings, SIGNAL_STYLE, { title: SIGNAL_TITLE, color: DEFAULT_SIGNAL_COLOR, width: LINE_WIDTH }),
  ];
}

function resolveLevels(settings: SettingValues): IndicatorLevel[] {
  return [
    levelSetting(settings, ZERO_LINE_STYLE, {
      title: ZERO_LINE_TITLE,
      price: ZERO_LINE_PRICE,
      color: DEFAULT_ZERO_LINE_COLOR,
      width: LINE_WIDTH,
    }),
  ];
}

/**
 * TradingView's MACD: two `ta.ema` lines of the source, the `ta.ema` signal of their difference and
 * the histogram between the two. The state stays as of the last closed bar, so a tick redraws its own
 * column without changing the column the next bar starts from.
 */
export class MacdIndicator extends BarByBarIndicator {
  private fastLength = DEFAULT_FAST_LENGTH;
  private slowLength = DEFAULT_SLOW_LENGTH;
  private signalLength = DEFAULT_SIGNAL_LENGTH;
  private source: SettingInputSource = DEFAULT_SOURCE;
  private colors: HistogramColors = DEFAULT_HISTOGRAM_COLORS;
  private state: MacdState = INITIAL_STATE;
  private computed: ComputedMacd | null = null;

  protected reset(settings: SettingValues): void {
    this.fastLength = numberSetting(settings, FAST_LENGTH_INPUT, DEFAULT_FAST_LENGTH);
    this.slowLength = numberSetting(settings, SLOW_LENGTH_INPUT, DEFAULT_SLOW_LENGTH);
    this.signalLength = numberSetting(settings, SIGNAL_LENGTH_INPUT, DEFAULT_SIGNAL_LENGTH);
    this.source = sourceSetting(settings, SOURCE_INPUT, DEFAULT_SOURCE);
    this.colors = resolveColors(settings);
    this.state = INITIAL_STATE;
    this.computed = null;
  }

  /** The histogram, the MACD and the signal of a bar, in the order the frame's plots draw them. */
  protected valuesAt(bar: RenderBar): readonly (number | null)[] {
    const { histogram, macd, signal } = this.macdAt(bar);
    return [histogram, macd, signal];
  }

  /** The histogram's column colour; the two lines take no per-bar colour, so they read as none. */
  protected colorsAt(bar: RenderBar): readonly (string | null)[] {
    const { histogram } = this.macdAt(bar);
    return [histogramColor(histogram, this.state.histogram, this.colors), null, null];
  }

  /** Moves the state on to a bar that closed, so the next bar starts from that bar's averages. */
  protected commit(bar: RenderBar): void {
    this.state = this.stateAfter(bar);
    this.computed = null;
  }

  /** The way the MACD is drawn, which no bar changes: three plots and the zero line they sit on. */
  protected frameStyle(settings: SettingValues): Omit<IndicatorFrame, 'bars'> {
    return { plots: resolvePlots(settings, this.colors), levels: resolveLevels(settings) };
  }

  /** The state once a bar closed: its source joins the two lines and its MACD joins the signal. */
  private stateAfter(bar: RenderBar): MacdState {
    const { histogram, macd } = this.macdAt(bar);
    const source = sourceValue(bar, this.source);
    return {
      fast: emaAfter(this.state.fast, source, this.fastLength),
      slow: emaAfter(this.state.slow, source, this.slowLength),
      signal: macd === null ? this.state.signal : emaAfter(this.state.signal, macd, this.signalLength),
      histogram,
    };
  }

  /**
   * The three values a bar plots, read from the state without moving it on. `valuesAt`, `colorsAt` and
   * `stateAfter` all ask for the same bar, so the values kept for the bar and the state are handed back.
   */
  private macdAt(bar: RenderBar): MacdValues {
    const computed = this.computed;
    if (computed !== null && computed.bar === bar && computed.state === this.state) {
      return computed.values;
    }
    const values = this.macdValuesOf(bar);
    this.computed = { bar, state: this.state, values };
    return values;
  }

  /** The three values a bar plots, from the state as it stands. */
  private macdValuesOf(bar: RenderBar): MacdValues {
    const source = sourceValue(bar, this.source);
    const fast = emaValue(emaAfter(this.state.fast, source, this.fastLength));
    const slow = emaValue(emaAfter(this.state.slow, source, this.slowLength));
    if (fast === null || slow === null) {
      return { macd: null, signal: null, histogram: null };
    }
    const macd = fast - slow;
    const signal = emaValue(emaAfter(this.state.signal, macd, this.signalLength));
    if (signal === null) {
      return { macd, signal: null, histogram: null };
    }
    return { macd, signal, histogram: macd - signal };
  }
}
