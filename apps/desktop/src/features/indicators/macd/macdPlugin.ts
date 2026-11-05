import type { SettingInputInt } from '../../chart/engine/settings/settingInputs';
import type { SettingStyleColor } from '../../chart/engine/settings/settingStyles';
import type { ChartIndicatorPlugin } from '../chartIndicatorPlugin';
import { lineStyle, sourceInput } from '../indicatorInputs';
import {
  DEFAULT_FAST_LENGTH,
  DEFAULT_HISTOGRAM_ABOVE_FALL_COLOR,
  DEFAULT_HISTOGRAM_ABOVE_GROW_COLOR,
  DEFAULT_HISTOGRAM_BELOW_FALL_COLOR,
  DEFAULT_HISTOGRAM_BELOW_GROW_COLOR,
  DEFAULT_MACD_COLOR,
  DEFAULT_SIGNAL_COLOR,
  DEFAULT_SIGNAL_LENGTH,
  DEFAULT_SLOW_LENGTH,
  DEFAULT_SOURCE,
  DEFAULT_ZERO_LINE_COLOR,
  FAST_LENGTH_INPUT,
  HISTOGRAM_ABOVE_FALL_STYLE,
  HISTOGRAM_ABOVE_GROW_STYLE,
  HISTOGRAM_BELOW_FALL_STYLE,
  HISTOGRAM_BELOW_GROW_STYLE,
  HISTOGRAM_STYLE,
  MACD_STYLE,
  MacdIndicator,
  SIGNAL_LENGTH_INPUT,
  SIGNAL_STYLE,
  SLOW_LENGTH_INPUT,
  ZERO_LINE_STYLE,
} from './macdIndicator';

const LENGTH_MIN = 1;
const LENGTH_STEP = 1;
const LENGTH_MAX = 5000;
const SIGNAL_LENGTH_MAX = 50;

/** The `int` input one MACD length is asked for, the two line lengths sharing the bounds of a window. */
function macdLengthInput(id: string, title: string, defaultValue: number, maxValue: number): SettingInputInt {
  return { kind: 'int', id, title, defaultValue, minValue: LENGTH_MIN, maxValue, step: LENGTH_STEP };
}

/** One histogram column colour, rendered under the histogram's toggle. */
function histogramColorStyle(id: string, title: string, color: string): SettingStyleColor {
  return { kind: 'color', id, title, parentId: HISTOGRAM_STYLE, defaults: { color } };
}

export const macdPlugin = {
  id: 'macd',
  title: 'MACD',
  shortTitle: 'MACD',
  pane: 'own',
  inputs: [
    macdLengthInput(FAST_LENGTH_INPUT, 'Fast Length', DEFAULT_FAST_LENGTH, LENGTH_MAX),
    macdLengthInput(SLOW_LENGTH_INPUT, 'Slow Length', DEFAULT_SLOW_LENGTH, LENGTH_MAX),
    sourceInput(DEFAULT_SOURCE),
    macdLengthInput(SIGNAL_LENGTH_INPUT, 'Signal Smoothing', DEFAULT_SIGNAL_LENGTH, SIGNAL_LENGTH_MAX),
  ],
  styles: [
    { kind: 'toggle', id: HISTOGRAM_STYLE, title: 'Histogram', defaults: { visible: true } },
    histogramColorStyle(HISTOGRAM_ABOVE_GROW_STYLE, 'Above Grow', DEFAULT_HISTOGRAM_ABOVE_GROW_COLOR),
    histogramColorStyle(HISTOGRAM_ABOVE_FALL_STYLE, 'Above Fall', DEFAULT_HISTOGRAM_ABOVE_FALL_COLOR),
    histogramColorStyle(HISTOGRAM_BELOW_GROW_STYLE, 'Below Grow', DEFAULT_HISTOGRAM_BELOW_GROW_COLOR),
    histogramColorStyle(HISTOGRAM_BELOW_FALL_STYLE, 'Below Fall', DEFAULT_HISTOGRAM_BELOW_FALL_COLOR),
    lineStyle(MACD_STYLE, 'MACD', DEFAULT_MACD_COLOR),
    lineStyle(SIGNAL_STYLE, 'Signal', DEFAULT_SIGNAL_COLOR),
    lineStyle(ZERO_LINE_STYLE, 'Zero Line', DEFAULT_ZERO_LINE_COLOR, 'dashed'),
  ],
  indicatorClass: MacdIndicator,
} as const satisfies ChartIndicatorPlugin;
