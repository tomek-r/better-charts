import type { SettingValues } from '../../chart/engine/settings/settingInputs';
import { settingStyleKey, type SettingStyleColor } from '../../chart/engine/settings/settingStyles';
import type { ChartIndicatorPlugin } from '../chartIndicatorPlugin';
import { booleanSetting } from '../indicatorSettingValues';
import { lengthInput, lineStyle } from '../indicatorInputs';
import { plotTypeStyle } from '../plotTypes';
import {
  DEFAULT_FALLING_COLOR,
  DEFAULT_GROWING_COLOR,
  DEFAULT_MA_COLOR,
  DEFAULT_MA_LENGTH,
  DEFAULT_MA_TYPE,
  DEFAULT_PLOT_TYPE,
  FALLING_STYLE,
  GROWING_STYLE,
  MA_LENGTH_INPUT,
  MA_STYLE,
  MA_TYPE_INPUT,
  PLOT_TYPE_STYLE,
  PRICE_LINE_STYLE,
  VOLUME_STYLE,
  VolumeIndicator,
} from './volumeIndicator';
import { EMA_TYPE, SMA_TYPE } from './volumeAverage';

/** The MA line is off until the user switches it on in the Style tab. */
const MA_LINE_VISIBLE = false;
/** The MA's two inputs, in the order the legend names them. */
const MA_INPUT_IDS = [MA_TYPE_INPUT, MA_LENGTH_INPUT];

/** One column colour, rendered under the Volume toggle. */
function volumeColorStyle(id: string, title: string, color: string): SettingStyleColor {
  return { kind: 'color', id, title, parentId: VOLUME_STYLE, defaults: { color } };
}

/** The MA line's style entry, off until the user switches it on in the Style tab. */
function volumeAverageStyle(): ReturnType<typeof lineStyle> {
  const line = lineStyle(MA_STYLE, 'Volume MA', DEFAULT_MA_COLOR);
  return { ...line, defaults: { ...line.defaults, visible: MA_LINE_VISIBLE } };
}

/** The legend names the MA inputs only while the MA line is on: off, they describe nothing it draws. */
function averageInputIds(settings: SettingValues): readonly string[] {
  const averageShown = booleanSetting(settings, settingStyleKey(MA_STYLE, 'visible'), MA_LINE_VISIBLE);
  if (!averageShown) {
    return [];
  }
  return MA_INPUT_IDS;
}

export const volumePlugin = {
  id: 'volume',
  title: 'Volume',
  shortTitle: 'Vol',
  pane: 'own',
  legendInputIds: averageInputIds,
  inputs: [
    {
      kind: 'enum',
      id: MA_TYPE_INPUT,
      title: 'MA Type',
      defaultValue: DEFAULT_MA_TYPE,
      options: [
        { value: SMA_TYPE, title: SMA_TYPE },
        { value: EMA_TYPE, title: EMA_TYPE },
      ],
    },
    lengthInput(DEFAULT_MA_LENGTH, { id: MA_LENGTH_INPUT, title: 'MA Length' }),
  ],
  styles: [
    { kind: 'toggle', id: VOLUME_STYLE, title: 'Volume', defaults: { visible: true } },
    plotTypeStyle(PLOT_TYPE_STYLE, {
      defaultType: DEFAULT_PLOT_TYPE,
      parentId: VOLUME_STYLE,
      priceLineId: PRICE_LINE_STYLE,
      inlineWithId: GROWING_STYLE,
    }),
    volumeColorStyle(GROWING_STYLE, 'Growing', DEFAULT_GROWING_COLOR),
    volumeColorStyle(FALLING_STYLE, 'Falling', DEFAULT_FALLING_COLOR),
    volumeAverageStyle(),
  ],
  indicatorClass: VolumeIndicator,
} as const satisfies ChartIndicatorPlugin;
