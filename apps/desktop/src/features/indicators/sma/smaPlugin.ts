import type { ChartIndicatorPlugin } from '../chartIndicatorPlugin';
import {
  DEFAULT_COLOR,
  DEFAULT_LENGTH,
  DEFAULT_SOURCE,
  DEFAULT_WIDTH,
  LENGTH_INPUT,
  PLOT_STYLE,
  SmaIndicator,
  SOURCE_INPUT,
} from './smaIndicator';

export const smaPlugin = {
  id: 'sma',
  title: 'Moving Average Simple',
  shortTitle: 'SMA',
  pane: 'overlay',
  inputs: [
    {
      kind: 'int',
      id: LENGTH_INPUT,
      title: 'Length',
      defaultValue: DEFAULT_LENGTH,
      minValue: 1,
      maxValue: 5000,
      step: 1,
    },
    { kind: 'source', id: SOURCE_INPUT, title: 'Source', defaultValue: DEFAULT_SOURCE },
  ],
  styles: [
    {
      kind: 'line',
      id: PLOT_STYLE,
      title: 'MA',
      defaults: { visible: true, color: DEFAULT_COLOR, width: DEFAULT_WIDTH, style: 'solid' },
    },
  ],
  indicatorClass: SmaIndicator,
} as const satisfies ChartIndicatorPlugin;
