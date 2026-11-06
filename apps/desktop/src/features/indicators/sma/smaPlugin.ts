import type { ChartIndicatorPlugin } from '../chartIndicatorPlugin';
import { lengthInput, lineStyle, sourceInput } from '../indicatorInputs';
import { DEFAULT_COLOR, DEFAULT_LENGTH, DEFAULT_SOURCE, PLOT_STYLE, SmaIndicator } from './smaIndicator';

export const smaPlugin = {
  id: 'sma',
  title: 'Moving Average Simple',
  shortTitle: 'SMA',
  pane: 'overlay',
  inputs: [lengthInput(DEFAULT_LENGTH), sourceInput(DEFAULT_SOURCE)],
  styles: [lineStyle(PLOT_STYLE, 'MA', DEFAULT_COLOR)],
  indicatorClass: SmaIndicator,
} as const satisfies ChartIndicatorPlugin;
