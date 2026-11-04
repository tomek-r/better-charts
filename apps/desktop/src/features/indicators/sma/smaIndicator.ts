import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { ChartIndicator } from '../../chart/engine/indicators/indicatorContract';
import type { IndicatorBar, IndicatorFrame, IndicatorPlot } from '../../chart/engine/indicators/indicatorFrame';
import { sourceValue } from '../../chart/engine/indicators/indicatorSource';
import {
  SETTING_INPUT_SOURCES,
  type SettingInputSource,
  type SettingValues,
} from '../../chart/engine/settings/settingInputs';
import { settingStyleKey } from '../../chart/engine/settings/settingStyles';
import { numberSetting, stringSetting } from '../indicatorSettingValues';

export const LENGTH_INPUT = 'length';
export const SOURCE_INPUT = 'source';
export const PLOT_STYLE = 'plot';
export const DEFAULT_LENGTH = 9;
export const DEFAULT_SOURCE: SettingInputSource = 'close';
export const DEFAULT_COLOR = '#2962FF';
export const DEFAULT_WIDTH = 1;

const PLOT_TITLE = 'SMA';
const PLOT_KIND = 'line';
const MILLISECONDS_PER_SECOND = 1000;

function isSettingInputSource(value: string): value is SettingInputSource {
  return (SETTING_INPUT_SOURCES as readonly string[]).includes(value);
}

function resolveLength(settings: SettingValues): number {
  return numberSetting(settings, LENGTH_INPUT, DEFAULT_LENGTH);
}

function resolveSource(settings: SettingValues): SettingInputSource {
  const source = stringSetting(settings, SOURCE_INPUT, DEFAULT_SOURCE);
  return isSettingInputSource(source) ? source : DEFAULT_SOURCE;
}

function resolvePlot(settings: SettingValues): IndicatorPlot {
  return {
    title: PLOT_TITLE,
    style: PLOT_KIND,
    color: stringSetting(settings, settingStyleKey(PLOT_STYLE, 'color'), DEFAULT_COLOR),
    lineWidth: numberSetting(settings, settingStyleKey(PLOT_STYLE, 'width'), DEFAULT_WIDTH),
  };
}

/** One bar of a frame, which carries a single plot value per bar. */
function frameBar(bar: RenderBar, value: number | null, confirmed: boolean): IndicatorBar {
  return { timeMs: bar.time * MILLISECONDS_PER_SECOND, confirmed, values: [value] };
}

/**
 * The average of the newest `length` source values, kept as a rolling sum over the
 * newest `length - 1` closed ones: a live tick never enters that window, so a new bar
 * costs one addition and at most one subtraction.
 */
export class SmaIndicator implements ChartIndicator {
  private length = DEFAULT_LENGTH;
  private source: SettingInputSource = DEFAULT_SOURCE;
  /** Source values of the last `length - 1` closed bars, oldest first. */
  private window: number[] = [];
  private windowSum = 0;
  private forming: RenderBar | null = null;

  load(bars: readonly RenderBar[], settings: SettingValues): IndicatorFrame {
    this.length = resolveLength(settings);
    this.source = resolveSource(settings);
    this.window = [];
    this.windowSum = 0;
    this.forming = null;

    const formingIndex = bars.length - 1;
    const indicatorBars = bars.map((bar, index) => {
      const value = this.average(bar);
      if (index < formingIndex) {
        this.commit(bar);
        return frameBar(bar, value, true);
      }
      this.forming = bar;
      return frameBar(bar, value, false);
    });
    return { plots: [resolvePlot(settings)], bars: indicatorBars };
  }

  update(bar: RenderBar, settings: SettingValues): IndicatorFrame {
    const plot = resolvePlot(settings);
    const forming = this.forming;
    if (forming !== null && bar.time < forming.time) {
      return { plots: [plot], bars: [] };
    }
    const closedBar = this.adopt(bar);
    const formingBar = frameBar(bar, this.average(bar), false);
    return { plots: [plot], bars: closedBar === null ? [formingBar] : [closedBar, formingBar] };
  }

  /**
   * Makes the new bar the forming one. The previous forming bar closes, unless it is the very
   * same bar (a tick) or there was none; a closed bar is returned once its value is read.
   */
  private adopt(bar: RenderBar): IndicatorBar | null {
    const forming = this.forming;
    if (forming === null || forming.time === bar.time) {
      this.forming = bar;
      return null;
    }
    const closedBar = frameBar(forming, this.average(forming), true);
    this.commit(forming);
    this.forming = bar;
    return closedBar;
  }

  /** The value a bar plots, or nothing until `length - 1` closed values are held. */
  private average(bar: RenderBar): number | null {
    if (this.window.length !== this.length - 1) {
      return null;
    }
    return (this.windowSum + sourceValue(bar, this.source)) / this.length;
  }

  /** Moves the value of a bar that just closed into the window. */
  private commit(bar: RenderBar): void {
    const value = sourceValue(bar, this.source);
    this.window.push(value);
    this.windowSum += value;
    if (this.window.length > this.length - 1) {
      this.windowSum -= this.window.shift() ?? 0;
    }
  }
}
