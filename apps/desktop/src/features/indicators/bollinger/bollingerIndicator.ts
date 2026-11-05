import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { ChartIndicator } from '../../chart/engine/indicators/indicatorContract';
import type {
  IndicatorBar,
  IndicatorFill,
  IndicatorFrame,
  IndicatorPlot,
} from '../../chart/engine/indicators/indicatorFrame';
import { sourceValue } from '../../chart/engine/indicators/indicatorSource';
import type { SettingInputSource, SettingValues } from '../../chart/engine/settings/settingInputs';
import { settingStyleKey } from '../../chart/engine/settings/settingStyles';
import { ClosedValueWindow, resolveWindowSettings, type WindowSettings } from '../closedValueWindow';
import { FormingBar } from '../formingBar';
import { indicatorFrameBar } from '../indicatorFrameBars';
import { booleanSetting, linePlotSetting, numberSetting, stringSetting } from '../indicatorSettingValues';

export { LENGTH_INPUT, SOURCE_INPUT } from '../indicatorInputs';
export const MULT_INPUT = 'mult';
export const BASIS_STYLE = 'basis';
export const UPPER_STYLE = 'upper';
export const LOWER_STYLE = 'lower';
export const BACKGROUND_STYLE = 'background';
export const DEFAULT_LENGTH = 20;
export const DEFAULT_SOURCE: SettingInputSource = 'close';
export const DEFAULT_MULT = 2;
export const DEFAULT_BASIS_COLOR = '#FF6D00';
export const DEFAULT_BAND_COLOR = '#2962FF';
export const DEFAULT_BACKGROUND_COLOR = '#2196F30D';
export const DEFAULT_WIDTH = 1;

const BASIS_TITLE = 'Basis';
const UPPER_TITLE = 'Upper';
const LOWER_TITLE = 'Lower';
const UPPER_PLOT_INDEX = 1;
const LOWER_PLOT_INDEX = 2;
const NO_VALUES = [null, null, null] as const;
const DEFAULT_WINDOW_SETTINGS: WindowSettings = { length: DEFAULT_LENGTH, source: DEFAULT_SOURCE };

function resolvePlots(settings: SettingValues): readonly IndicatorPlot[] {
  return [
    linePlotSetting(settings, BASIS_STYLE, { title: BASIS_TITLE, color: DEFAULT_BASIS_COLOR, width: DEFAULT_WIDTH }),
    linePlotSetting(settings, UPPER_STYLE, { title: UPPER_TITLE, color: DEFAULT_BAND_COLOR, width: DEFAULT_WIDTH }),
    linePlotSetting(settings, LOWER_STYLE, { title: LOWER_TITLE, color: DEFAULT_BAND_COLOR, width: DEFAULT_WIDTH }),
  ];
}

/** The band between the upper and the lower plot, unless the Background style switches it off. */
function resolveFills(settings: SettingValues): readonly IndicatorFill[] {
  if (!booleanSetting(settings, settingStyleKey(BACKGROUND_STYLE, 'visible'), true)) {
    return [];
  }
  return [
    {
      from: { kind: 'plot', index: UPPER_PLOT_INDEX },
      to: { kind: 'plot', index: LOWER_PLOT_INDEX },
      color: stringSetting(settings, settingStyleKey(BACKGROUND_STYLE, 'color'), DEFAULT_BACKGROUND_COLOR),
    },
  ];
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Pine's `ta.stdev`: the population deviation, so the squared deviations divide by the window size. */
function populationDeviationOf(values: readonly number[], mean: number): number {
  const squaredDeviations = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return Math.sqrt(squaredDeviations / values.length);
}

/**
 * The basis and the two bands of the newest `length` source values: the basis averages them, and
 * the bands sit `mult` population deviations away from it, the way Pine's `ta.stdev` measures a
 * window.
 */
export class BollingerIndicator implements ChartIndicator {
  private source: SettingInputSource = DEFAULT_SOURCE;
  private mult = DEFAULT_MULT;
  private window = new ClosedValueWindow();
  private forming = new FormingBar();

  load(bars: readonly RenderBar[], settings: SettingValues): IndicatorFrame {
    const { length, source } = resolveWindowSettings(settings, DEFAULT_WINDOW_SETTINGS);
    this.source = source;
    this.mult = numberSetting(settings, MULT_INPUT, DEFAULT_MULT);
    this.window.reset(length - 1);
    this.forming.reset();

    const confirmedBars = bars.slice(0, -1).map((bar) => this.confirmedBar(bar));
    const formingBars = bars.slice(-1).map((bar) => {
      this.forming.adopt(bar);
      return this.formingBar(bar);
    });
    return {
      plots: resolvePlots(settings),
      bars: [...confirmedBars, ...formingBars],
      fills: resolveFills(settings),
    };
  }

  update(bar: RenderBar, settings: SettingValues): IndicatorFrame {
    const plots = resolvePlots(settings);
    const fills = resolveFills(settings);
    if (this.forming.isBehind(bar)) {
      return { plots, bars: [], fills };
    }
    const closedBar = this.forming.adopt(bar);
    const closedBars = closedBar === null ? [] : [this.confirmedBar(closedBar)];
    return { plots, bars: [...closedBars, this.formingBar(bar)], fills };
  }

  /** Frames a bar that is final: its values are read before the bar enters the window. */
  private confirmedBar(bar: RenderBar): IndicatorBar {
    const values = this.valuesAt(bar);
    this.commit(bar);
    return indicatorFrameBar(bar, values, true);
  }

  /** Frames the bar the chart is still drawing, which stays out of the window. */
  private formingBar(bar: RenderBar): IndicatorBar {
    return indicatorFrameBar(bar, this.valuesAt(bar), false);
  }

  /**
   * The basis and its two bands for a bar, or nothing until `length - 1` closed values are held.
   *
   * The window plus the bar's own value is measured in two passes, mean then squared deviations,
   * so a long window of large prices keeps its precision.
   */
  private valuesAt(bar: RenderBar): readonly (number | null)[] {
    if (!this.window.isFull()) {
      return NO_VALUES;
    }
    const windowValues = [...this.window.values(), sourceValue(bar, this.source)];
    const basis = meanOf(windowValues);
    const bandOffset = this.mult * populationDeviationOf(windowValues, basis);
    return [basis, basis + bandOffset, basis - bandOffset];
  }

  /** Moves the value of a bar that just closed into the window. */
  private commit(bar: RenderBar): void {
    this.window.push(sourceValue(bar, this.source));
  }
}
