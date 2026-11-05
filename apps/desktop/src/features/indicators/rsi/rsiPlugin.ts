import type { ChartIndicatorPlugin } from '../chartIndicatorPlugin';
import { lengthInput, lineStyle, sourceInput } from '../indicatorInputs';
import {
  BACKGROUND_STYLE,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BAND_COLOR,
  DEFAULT_COLOR,
  DEFAULT_LENGTH,
  DEFAULT_MIDDLE_BAND_COLOR,
  DEFAULT_SOURCE,
  LOWER_BAND_STYLE,
  MIDDLE_BAND_STYLE,
  PLOT_STYLE,
  RsiIndicator,
  UPPER_BAND_STYLE,
} from './rsiIndicator';

export const rsiPlugin = {
  id: 'rsi',
  title: 'Relative Strength Index',
  shortTitle: 'RSI',
  pane: 'own',
  inputs: [lengthInput(DEFAULT_LENGTH), sourceInput(DEFAULT_SOURCE)],
  styles: [
    lineStyle(PLOT_STYLE, 'RSI', DEFAULT_COLOR),
    lineStyle(UPPER_BAND_STYLE, 'Upper Band', DEFAULT_BAND_COLOR, 'dashed'),
    lineStyle(MIDDLE_BAND_STYLE, 'Middle Band', DEFAULT_MIDDLE_BAND_COLOR, 'dotted'),
    lineStyle(LOWER_BAND_STYLE, 'Lower Band', DEFAULT_BAND_COLOR, 'dashed'),
    {
      kind: 'color',
      id: BACKGROUND_STYLE,
      title: 'Background',
      defaults: { visible: true, color: DEFAULT_BACKGROUND_COLOR },
    },
  ],
  indicatorClass: RsiIndicator,
} as const satisfies ChartIndicatorPlugin;
