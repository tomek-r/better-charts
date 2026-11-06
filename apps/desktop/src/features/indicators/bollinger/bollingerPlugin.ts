import type { ChartIndicatorPlugin } from '../chartIndicatorPlugin';
import { lengthInput, lineStyle, sourceInput } from '../indicatorInputs';
import {
  BACKGROUND_STYLE,
  BASIS_STYLE,
  BollingerIndicator,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BAND_COLOR,
  DEFAULT_BASIS_COLOR,
  DEFAULT_LENGTH,
  DEFAULT_MULT,
  DEFAULT_SOURCE,
  LOWER_STYLE,
  MULT_INPUT,
  UPPER_STYLE,
} from './bollingerIndicator';

export const bollingerPlugin = {
  id: 'bb',
  title: 'Bollinger Bands',
  shortTitle: 'BB',
  pane: 'overlay',
  inputs: [
    lengthInput(DEFAULT_LENGTH),
    sourceInput(DEFAULT_SOURCE),
    {
      kind: 'float',
      id: MULT_INPUT,
      title: 'StdDev',
      defaultValue: DEFAULT_MULT,
      minValue: 0.001,
      maxValue: 50,
      step: 0.1,
    },
  ],
  styles: [
    lineStyle(BASIS_STYLE, 'Basis', DEFAULT_BASIS_COLOR),
    lineStyle(UPPER_STYLE, 'Upper', DEFAULT_BAND_COLOR),
    lineStyle(LOWER_STYLE, 'Lower', DEFAULT_BAND_COLOR),
    {
      kind: 'color',
      id: BACKGROUND_STYLE,
      title: 'Background',
      defaults: { visible: true, color: DEFAULT_BACKGROUND_COLOR },
    },
  ],
  indicatorClass: BollingerIndicator,
} as const satisfies ChartIndicatorPlugin;
