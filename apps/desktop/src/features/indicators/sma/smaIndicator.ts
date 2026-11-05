import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { ChartIndicator } from '../../chart/engine/indicators/indicatorContract';
import type { IndicatorBar, IndicatorFrame, IndicatorPlot } from '../../chart/engine/indicators/indicatorFrame';
import { sourceValue } from '../../chart/engine/indicators/indicatorSource';
import type { SettingInputSource, SettingValues } from '../../chart/engine/settings/settingInputs';
import { ClosedValueWindow, resolveWindowSettings, type WindowSettings } from '../closedValueWindow';
import { FormingBar } from '../formingBar';
import { indicatorFrameBar } from '../indicatorFrameBars';
import { linePlotSetting } from '../indicatorSettingValues';

export { LENGTH_INPUT, SOURCE_INPUT } from '../indicatorInputs';
export const PLOT_STYLE = 'plot';
export const DEFAULT_LENGTH = 9;
export const DEFAULT_SOURCE: SettingInputSource = 'close';
export const DEFAULT_COLOR = '#2962FF';
export const DEFAULT_WIDTH = 1;

const PLOT_TITLE = 'SMA';
const DEFAULT_WINDOW_SETTINGS: WindowSettings = { length: DEFAULT_LENGTH, source: DEFAULT_SOURCE };

function resolvePlot(settings: SettingValues): IndicatorPlot {
  return linePlotSetting(settings, PLOT_STYLE, { title: PLOT_TITLE, color: DEFAULT_COLOR, width: DEFAULT_WIDTH });
}

/**
 * The average of the newest `length` source values, kept as a rolling sum over the
 * newest `length - 1` closed ones: a live tick never enters that window, so a new bar
 * costs one addition and at most one subtraction.
 */
export class SmaIndicator implements ChartIndicator {
  private length = DEFAULT_LENGTH;
  private source: SettingInputSource = DEFAULT_SOURCE;
  private window = new ClosedValueWindow();
  private windowSum = 0;
  private forming = new FormingBar();

  load(bars: readonly RenderBar[], settings: SettingValues): IndicatorFrame {
    const { length, source } = resolveWindowSettings(settings, DEFAULT_WINDOW_SETTINGS);
    this.length = length;
    this.source = source;
    this.window.reset(length - 1);
    this.windowSum = 0;
    this.forming.reset();

    const formingIndex = bars.length - 1;
    const indicatorBars = bars.map((bar, index) => {
      if (index === formingIndex) {
        this.forming.adopt(bar);
        return indicatorFrameBar(bar, [this.average(bar)], false);
      }
      return this.confirmedBar(bar);
    });
    return { plots: [resolvePlot(settings)], bars: indicatorBars };
  }

  update(bar: RenderBar, settings: SettingValues): IndicatorFrame {
    const plot = resolvePlot(settings);
    if (this.forming.isBehind(bar)) {
      return { plots: [plot], bars: [] };
    }
    const closedBar = this.forming.adopt(bar);
    const closedBars = closedBar === null ? [] : [this.confirmedBar(closedBar)];
    return { plots: [plot], bars: [...closedBars, indicatorFrameBar(bar, [this.average(bar)], false)] };
  }

  /** Frames a bar that is final: its value is read before the bar enters the window. */
  private confirmedBar(bar: RenderBar): IndicatorBar {
    const value = this.average(bar);
    this.commit(bar);
    return indicatorFrameBar(bar, [value], true);
  }

  /** The value a bar plots, or nothing until `length - 1` closed values are held. */
  private average(bar: RenderBar): number | null {
    if (!this.window.isFull()) {
      return null;
    }
    return (this.windowSum + sourceValue(bar, this.source)) / this.length;
  }

  /** Moves the value of a bar that just closed into the window, keeping the rolling sum in step. */
  private commit(bar: RenderBar): void {
    const value = sourceValue(bar, this.source);
    const dropped = this.window.push(value);
    this.windowSum += value;
    if (dropped !== undefined) {
      this.windowSum -= dropped;
    }
  }
}
