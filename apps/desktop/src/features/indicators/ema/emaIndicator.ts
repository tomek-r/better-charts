import type { IndicatorFrame } from '../../chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { ExponentialClosedAverage, type ClosedAverage } from '../closedAverage';
import { ClosedAverageIndicator } from '../closedAverageIndicator';
import { linePlotSetting } from '../indicatorSettingValues';
import { DEFAULT_COLOR, DEFAULT_WIDTH, PLOT_STYLE } from '../movingAverageDefaults';

export { DEFAULT_COLOR, DEFAULT_LENGTH, DEFAULT_SOURCE, DEFAULT_WIDTH, PLOT_STYLE } from '../movingAverageDefaults';
export { LENGTH_INPUT, SOURCE_INPUT } from '../indicatorInputs';

/**
 * Pine's `ta.ema` over the indicator's source: the first `length` source values seed the average and
 * the weight `2 / (length + 1)` smooths from there, on the state as of the last closed bar.
 */
export class EmaIndicator extends ClosedAverageIndicator {
  protected averageOf(length: number): ClosedAverage {
    return new ExponentialClosedAverage(length);
  }

  protected frameStyle(settings: SettingValues): Omit<IndicatorFrame, 'bars'> {
    return {
      plots: [linePlotSetting(settings, PLOT_STYLE, { title: 'EMA', color: DEFAULT_COLOR, width: DEFAULT_WIDTH })],
    };
  }
}
