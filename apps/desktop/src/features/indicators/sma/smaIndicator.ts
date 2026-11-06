import type { IndicatorFrame, IndicatorPlot } from '../../chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { SimpleClosedAverage, type ClosedAverage } from '../closedAverage';
import { ClosedAverageIndicator } from '../closedAverageIndicator';
import { linePlotSetting } from '../indicatorSettingValues';
import { DEFAULT_COLOR, DEFAULT_WIDTH, PLOT_STYLE } from '../movingAverageDefaults';

export { LENGTH_INPUT, SOURCE_INPUT } from '../indicatorInputs';
export { DEFAULT_COLOR, DEFAULT_LENGTH, DEFAULT_SOURCE, DEFAULT_WIDTH, PLOT_STYLE } from '../movingAverageDefaults';

const PLOT_TITLE = 'SMA';

function resolvePlot(settings: SettingValues): IndicatorPlot {
  return linePlotSetting(settings, PLOT_STYLE, { title: PLOT_TITLE, color: DEFAULT_COLOR, width: DEFAULT_WIDTH });
}

/** Pine's `ta.sma` over the indicator's source: the average of the newest `length` source values. */
export class SmaIndicator extends ClosedAverageIndicator {
  protected averageOf(length: number): ClosedAverage {
    return new SimpleClosedAverage(length);
  }

  protected frameStyle(settings: SettingValues): Omit<IndicatorFrame, 'bars'> {
    return { plots: [resolvePlot(settings)] };
  }
}
