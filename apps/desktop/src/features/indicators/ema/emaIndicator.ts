import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { IndicatorFrame } from '../../chart/engine/indicators/indicatorFrame';
import { sourceValue } from '../../chart/engine/indicators/indicatorSource';
import type { SettingInputSource, SettingValues } from '../../chart/engine/settings/settingInputs';
import { BarByBarIndicator } from '../barByBarIndicator';
import { resolveWindowSettings } from '../closedValueWindow';
import { emaAfter, emaValue, INITIAL_EMA_STATE, type EmaState } from '../emaState';
import { linePlotSetting } from '../indicatorSettingValues';
import {
  DEFAULT_COLOR,
  DEFAULT_LENGTH,
  DEFAULT_SOURCE,
  DEFAULT_WIDTH,
  PLOT_STYLE,
  WINDOW_DEFAULTS,
} from '../movingAverageDefaults';

export { DEFAULT_COLOR, DEFAULT_LENGTH, DEFAULT_SOURCE, DEFAULT_WIDTH, PLOT_STYLE } from '../movingAverageDefaults';
export { LENGTH_INPUT, SOURCE_INPUT } from '../indicatorInputs';

/**
 * Pine's `ta.ema`: the first `length` values seed the average and the weight `2 / (length + 1)`
 * smooths from there. The state stays as of the last closed bar, so `valuesAt` draws the forming
 * bar on top of it without moving it on and only `commit` advances it.
 */
export class EmaIndicator extends BarByBarIndicator {
  private length = DEFAULT_LENGTH;
  private source: SettingInputSource = DEFAULT_SOURCE;
  private state: EmaState = INITIAL_EMA_STATE;

  protected reset(settings: SettingValues): void {
    const windowSettings = resolveWindowSettings(settings, WINDOW_DEFAULTS);
    this.length = windowSettings.length;
    this.source = windowSettings.source;
    this.state = INITIAL_EMA_STATE;
  }

  protected valuesAt(bar: RenderBar): readonly (number | null)[] {
    return [emaValue(this.stateAfter(bar))];
  }

  protected commit(bar: RenderBar): void {
    this.state = this.stateAfter(bar);
  }

  protected frameStyle(settings: SettingValues): Omit<IndicatorFrame, 'bars'> {
    return {
      plots: [linePlotSetting(settings, PLOT_STYLE, { title: 'EMA', color: DEFAULT_COLOR, width: DEFAULT_WIDTH })],
    };
  }

  private stateAfter(bar: RenderBar): EmaState {
    return emaAfter(this.state, sourceValue(bar, this.source), this.length);
  }
}
