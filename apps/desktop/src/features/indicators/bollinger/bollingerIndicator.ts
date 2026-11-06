import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { IndicatorFill, IndicatorFrame, IndicatorPlot } from '../../chart/engine/indicators/indicatorFrame';
import { sourceValue } from '../../chart/engine/indicators/indicatorSource';
import type { SettingInputSource, SettingValues } from '../../chart/engine/settings/settingInputs';
import { backgroundFill } from '../backgroundFill';
import { BarByBarIndicator } from '../barByBarIndicator';
import { ClosedValueWindow, resolveWindowSettings, type WindowSettings } from '../closedValueWindow';
import { linePlotSetting, numberSetting } from '../indicatorSettingValues';

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
  return backgroundFill(
    settings,
    BACKGROUND_STYLE,
    DEFAULT_BACKGROUND_COLOR,
    { kind: 'plot', index: UPPER_PLOT_INDEX },
    { kind: 'plot', index: LOWER_PLOT_INDEX },
  );
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
export class BollingerIndicator extends BarByBarIndicator {
  private source: SettingInputSource = DEFAULT_SOURCE;
  private mult = DEFAULT_MULT;
  private window = new ClosedValueWindow();

  protected reset(settings: SettingValues): void {
    const { length, source } = resolveWindowSettings(settings, DEFAULT_WINDOW_SETTINGS);
    this.source = source;
    this.mult = numberSetting(settings, MULT_INPUT, DEFAULT_MULT);
    this.window.reset(length - 1);
  }

  /**
   * The basis and its two bands for a bar, or nothing until `length - 1` closed values are held.
   *
   * The window plus the bar's own value is measured in two passes, mean then squared deviations,
   * so a long window of large prices keeps its precision.
   */
  protected valuesAt(bar: RenderBar): readonly (number | null)[] {
    if (!this.window.isFull()) {
      return NO_VALUES;
    }
    const windowValues = [...this.window.values(), sourceValue(bar, this.source)];
    const basis = meanOf(windowValues);
    const bandOffset = this.mult * populationDeviationOf(windowValues, basis);
    return [basis, basis + bandOffset, basis - bandOffset];
  }

  /** Moves the value of a bar that just closed into the window. */
  protected commit(bar: RenderBar): void {
    this.window.push(sourceValue(bar, this.source));
  }

  protected frameStyle(settings: SettingValues): Omit<IndicatorFrame, 'bars'> {
    return { plots: resolvePlots(settings), fills: resolveFills(settings) };
  }
}
