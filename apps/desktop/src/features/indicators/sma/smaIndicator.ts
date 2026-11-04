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
const LIVE_BAR_COUNT = 2;
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

/**
 * The average of the last `length` source values, with a rolling sum so each bar
 * costs one addition and at most one subtraction. A bar has no value until
 * `length` bars exist.
 */
export function smaValues(bars: readonly RenderBar[], length: number, source: SettingInputSource): (number | null)[] {
  const values: (number | null)[] = [];
  let rollingSum = 0;
  bars.forEach((bar, index) => {
    rollingSum += sourceValue(bar, source);
    const leavingBar = index >= length ? bars[index - length] : null;
    if (leavingBar !== null) {
      rollingSum -= sourceValue(leavingBar, source);
    }
    values.push(index >= length - 1 ? rollingSum / length : null);
  });
  return values;
}

/** One frame whose newest bar is the forming one and every other bar is closed. */
function buildFrame(
  bars: readonly RenderBar[],
  values: readonly (number | null)[],
  plot: IndicatorPlot,
): IndicatorFrame {
  const newestIndex = bars.length - 1;
  const indicatorBars: IndicatorBar[] = bars.map((bar, index) => ({
    timeMs: bar.time * MILLISECONDS_PER_SECOND,
    confirmed: index < newestIndex,
    values: [values[index] ?? null],
  }));
  return { plots: [plot], bars: indicatorBars };
}

export class SmaIndicator implements ChartIndicator {
  load(bars: readonly RenderBar[], settings: SettingValues): IndicatorFrame {
    const length = resolveLength(settings);
    const values = smaValues(bars, length, resolveSource(settings));
    return buildFrame(bars, values, resolvePlot(settings));
  }

  update(bars: readonly RenderBar[], settings: SettingValues): IndicatorFrame {
    const length = resolveLength(settings);
    // One bar beyond the average window seeds the rolling sum, so the closed bar keeps its value.
    const computedBars = bars.slice(-(length + 1));
    const values = smaValues(computedBars, length, resolveSource(settings));
    return buildFrame(computedBars.slice(-LIVE_BAR_COUNT), values.slice(-LIVE_BAR_COUNT), resolvePlot(settings));
  }
}
