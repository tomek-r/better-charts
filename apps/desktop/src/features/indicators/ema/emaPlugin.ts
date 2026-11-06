import type { ChartIndicatorPlugin } from '../chartIndicatorPlugin';
import { lengthInput, lineStyle, sourceInput } from '../indicatorInputs';
import { DEFAULT_COLOR, DEFAULT_LENGTH, DEFAULT_SOURCE, EmaIndicator, PLOT_STYLE } from './emaIndicator';

export const emaPlugin = {
  id: 'ema',
  title: 'Moving Average Exponential',
  shortTitle: 'EMA',
  pane: 'overlay',
  inputs: [lengthInput(DEFAULT_LENGTH), sourceInput(DEFAULT_SOURCE)],
  styles: [lineStyle(PLOT_STYLE, 'EMA', DEFAULT_COLOR)],
  indicatorClass: EmaIndicator,
} as const satisfies ChartIndicatorPlugin;
