import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { IndicatorFrame, IndicatorPlot } from '../../chart/engine/indicators/indicatorFrame';
import { sourceValue } from '../../chart/engine/indicators/indicatorSource';
import type { SettingInputSource, SettingValues } from '../../chart/engine/settings/settingInputs';
import { BarByBarIndicator } from '../barByBarIndicator';
import { ClosedValueWindow, resolveWindowSettings } from '../closedValueWindow';
import { linePlotSetting } from '../indicatorSettingValues';
import {
  DEFAULT_COLOR,
  DEFAULT_LENGTH,
  DEFAULT_SOURCE,
  DEFAULT_WIDTH,
  PLOT_STYLE,
  WINDOW_DEFAULTS,
} from '../movingAverageDefaults';

export { LENGTH_INPUT, SOURCE_INPUT } from '../indicatorInputs';
export { DEFAULT_COLOR, DEFAULT_LENGTH, DEFAULT_SOURCE, DEFAULT_WIDTH, PLOT_STYLE } from '../movingAverageDefaults';

const PLOT_TITLE = 'SMA';

function resolvePlot(settings: SettingValues): IndicatorPlot {
  return linePlotSetting(settings, PLOT_STYLE, { title: PLOT_TITLE, color: DEFAULT_COLOR, width: DEFAULT_WIDTH });
}

/**
 * The average of the newest `length` source values, kept as a rolling sum over the
 * newest `length - 1` closed ones: a live tick never enters that window, so a new bar
 * costs one addition and at most one subtraction.
 */
export class SmaIndicator extends BarByBarIndicator {
  private length = DEFAULT_LENGTH;
  private source: SettingInputSource = DEFAULT_SOURCE;
  private window = new ClosedValueWindow();
  private windowSum = 0;

  protected reset(settings: SettingValues): void {
    const { length, source } = resolveWindowSettings(settings, WINDOW_DEFAULTS);
    this.length = length;
    this.source = source;
    this.window.reset(length - 1);
    this.windowSum = 0;
  }

  protected valuesAt(bar: RenderBar): readonly (number | null)[] {
    return [this.average(bar)];
  }

  /** Moves the value of a bar that just closed into the window, keeping the rolling sum in step. */
  protected commit(bar: RenderBar): void {
    const value = sourceValue(bar, this.source);
    const dropped = this.window.push(value);
    this.windowSum += value;
    if (dropped !== undefined) {
      this.windowSum -= dropped;
    }
  }

  protected frameStyle(settings: SettingValues): Omit<IndicatorFrame, 'bars'> {
    return { plots: [resolvePlot(settings)] };
  }

  /** The value a bar plots, or nothing until `length - 1` closed values are held. */
  private average(bar: RenderBar): number | null {
    if (!this.window.isFull()) {
      return null;
    }
    return (this.windowSum + sourceValue(bar, this.source)) / this.length;
  }
}
