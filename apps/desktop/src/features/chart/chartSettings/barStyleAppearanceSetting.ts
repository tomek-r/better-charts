import { palette } from '../../../shared/theme/palette';
import type { BarStyle } from '../engine/barStyle/barStyles';
import {
  isBarStyleLineWidth,
  type AreaAppearance,
  type BarDirectionColors,
  type BarStyleAppearance,
  type BarStyleLineWidth,
  type BarsAppearance,
  type BaselineAppearance,
  type ColumnsAppearance,
  type DrawnBarStyleAppearance,
  type LineStyleAppearance,
} from '../engine/barStyle/barStyleAppearance';
import { isPriceSource, type PriceSource } from '../engine/barStyle/priceSource';
import { BAR_STYLE_SETTINGS } from './barStyleSettings';
import { candleAppearanceOf } from './candleAppearanceSetting';
import type { BarStyleSettingValues } from './chartSettings';
import { readSettingValue } from './settingFields';
import { isSettingRecord } from './settingValueReaders';

const COLOR_BY_PREVIOUS_CLOSE_KEY = 'colorByPreviousClose';
const COLORS_KEY = 'colors';
const THIN_BARS_KEY = 'thinBars';
const HLC_BARS_KEY = 'hlcBars';
const PRICE_SOURCE_KEY = 'priceSource';
const BASE_LEVEL_KEY = 'baseLevel';
const LINE_COLOR_KEY = 'lineColor';
const LINE_WIDTH_KEY = 'lineWidth';
const FILL_TOP_KEY = 'fillTop';
const FILL_BOTTOM_KEY = 'fillBottom';
const TOP_LINE_KEY = 'topLine';
const TOP_FILL_KEY = 'topFill';
const BOTTOM_LINE_KEY = 'bottomLine';
const BOTTOM_FILL_KEY = 'bottomFill';

/**
 * What a style draws when its own settings hold nothing its fields can explain — the values the
 * settings dialog shows. A single unreadable value already falls back to its own field's default.
 */
const DEFAULT_COLORS: BarDirectionColors = { up: palette.up, down: palette.sell };
const BARS_DEFAULTS: Omit<BarsAppearance, 'style'> = {
  colorByPreviousClose: false,
  colors: DEFAULT_COLORS,
  thinBars: true,
  hlcBars: false,
};
const LINE_DEFAULTS: Omit<LineStyleAppearance, 'style'> = { priceSource: 'close', color: palette.info, lineWidth: 2 };
const AREA_DEFAULTS: Omit<AreaAppearance, 'style'> = {
  priceSource: 'close',
  lineColor: palette.info,
  lineWidth: 2,
  fillTop: palette.infoWash,
  fillBottom: palette.infoClear,
};
const COLUMNS_DEFAULTS: Omit<ColumnsAppearance, 'style'> = { colorByPreviousClose: false, colors: DEFAULT_COLORS };
/** The level a baseline turns around when its own setting holds nothing readable: the middle of the range. */
const DEFAULT_BASE_LEVEL = 50;
const BASELINE_DEFAULTS: Omit<BaselineAppearance, 'style'> = {
  priceSource: 'close',
  baseLevel: DEFAULT_BASE_LEVEL,
  topLine: palette.up,
  topFill: palette.upWash,
  bottomLine: palette.sell,
  bottomFill: palette.sellWashStrong,
  lineWidth: 2,
};

/** The settings field a style declares under `key`; a style declares only the keys its own section holds. */
function fieldOf(style: BarStyle, key: string) {
  return BAR_STYLE_SETTINGS[style].fields.find((field) => field.key === key);
}

/** One stored value, or its field's own default when the store holds nothing that fits the field. */
function fieldValue(style: BarStyle, key: string, values: BarStyleSettingValues): unknown {
  const field = fieldOf(style, key);
  return field === undefined ? undefined : (readSettingValue(field, values[key]) ?? field.defaultValue);
}

function readBoolean(style: BarStyle, key: string, values: BarStyleSettingValues): boolean | undefined {
  const value = fieldValue(style, key, values);
  return typeof value === 'boolean' ? value : undefined;
}

function readColor(style: BarStyle, key: string, values: BarStyleSettingValues): string | undefined {
  const value = fieldValue(style, key, values);
  return typeof value === 'string' ? value : undefined;
}

function readColorPair(style: BarStyle, key: string, values: BarStyleSettingValues): BarDirectionColors | undefined {
  const value = fieldValue(style, key, values);
  if (!isSettingRecord(value) || typeof value.up !== 'string' || typeof value.down !== 'string') {
    return undefined;
  }
  return { up: value.up, down: value.down };
}

function readPriceSource(style: BarStyle, values: BarStyleSettingValues): PriceSource | undefined {
  const value = fieldValue(style, PRICE_SOURCE_KEY, values);
  return isPriceSource(value) ? value : undefined;
}

function readLineWidth(style: BarStyle, values: BarStyleSettingValues): BarStyleLineWidth | undefined {
  const value = fieldValue(style, LINE_WIDTH_KEY, values);
  return isBarStyleLineWidth(value) ? value : undefined;
}

function readBaseLevel(values: BarStyleSettingValues): number | undefined {
  const value = fieldValue('baseline', BASE_LEVEL_KEY, values);
  return typeof value === 'number' ? value : undefined;
}

function barsAppearance(style: BarStyle, values: BarStyleSettingValues): BarsAppearance {
  return {
    style: 'bars',
    colorByPreviousClose: readBoolean(style, COLOR_BY_PREVIOUS_CLOSE_KEY, values) ?? BARS_DEFAULTS.colorByPreviousClose,
    colors: readColorPair(style, COLORS_KEY, values) ?? BARS_DEFAULTS.colors,
    thinBars: readBoolean(style, THIN_BARS_KEY, values) ?? BARS_DEFAULTS.thinBars,
    hlcBars: readBoolean(style, HLC_BARS_KEY, values) ?? BARS_DEFAULTS.hlcBars,
  };
}

function lineAppearance(
  style: 'line' | 'lineWithMarkers' | 'stepLine',
  values: BarStyleSettingValues,
): LineStyleAppearance {
  return {
    style,
    priceSource: readPriceSource(style, values) ?? LINE_DEFAULTS.priceSource,
    color: readColor(style, LINE_COLOR_KEY, values) ?? LINE_DEFAULTS.color,
    lineWidth: readLineWidth(style, values) ?? LINE_DEFAULTS.lineWidth,
  };
}

function areaAppearance(values: BarStyleSettingValues): AreaAppearance {
  return {
    style: 'area',
    priceSource: readPriceSource('area', values) ?? AREA_DEFAULTS.priceSource,
    lineColor: readColor('area', LINE_COLOR_KEY, values) ?? AREA_DEFAULTS.lineColor,
    lineWidth: readLineWidth('area', values) ?? AREA_DEFAULTS.lineWidth,
    fillTop: readColor('area', FILL_TOP_KEY, values) ?? AREA_DEFAULTS.fillTop,
    fillBottom: readColor('area', FILL_BOTTOM_KEY, values) ?? AREA_DEFAULTS.fillBottom,
  };
}

function columnsAppearance(style: BarStyle, values: BarStyleSettingValues): ColumnsAppearance {
  return {
    style: 'columns',
    colorByPreviousClose:
      readBoolean(style, COLOR_BY_PREVIOUS_CLOSE_KEY, values) ?? COLUMNS_DEFAULTS.colorByPreviousClose,
    colors: readColorPair(style, COLORS_KEY, values) ?? COLUMNS_DEFAULTS.colors,
  };
}

function baselineAppearance(values: BarStyleSettingValues): BaselineAppearance {
  return {
    style: 'baseline',
    priceSource: readPriceSource('baseline', values) ?? BASELINE_DEFAULTS.priceSource,
    baseLevel: readBaseLevel(values) ?? BASELINE_DEFAULTS.baseLevel,
    topLine: readColor('baseline', TOP_LINE_KEY, values) ?? BASELINE_DEFAULTS.topLine,
    topFill: readColor('baseline', TOP_FILL_KEY, values) ?? BASELINE_DEFAULTS.topFill,
    bottomLine: readColor('baseline', BOTTOM_LINE_KEY, values) ?? BASELINE_DEFAULTS.bottomLine,
    bottomFill: readColor('baseline', BOTTOM_FILL_KEY, values) ?? BASELINE_DEFAULTS.bottomFill,
    lineWidth: readLineWidth('baseline', values) ?? BASELINE_DEFAULTS.lineWidth,
  };
}

/**
 * The chart's bar style as the engine draws it. Every value is read through the settings field of its
 * own key, so a store holding nothing readable leaves the chart on the defaults the dialog shows.
 *
 * A caller that names a style the bar style series draws itself gets that appearance back, so the
 * points it writes need no narrowing of their own.
 */
export function barStyleAppearanceOf(
  style: DrawnBarStyleAppearance['style'],
  values: BarStyleSettingValues,
): DrawnBarStyleAppearance;
export function barStyleAppearanceOf(style: BarStyle, values: BarStyleSettingValues): BarStyleAppearance;
export function barStyleAppearanceOf(style: BarStyle, values: BarStyleSettingValues): BarStyleAppearance {
  switch (style) {
    case 'bars':
      return barsAppearance(style, values);
    case 'line':
    case 'lineWithMarkers':
    case 'stepLine':
      return lineAppearance(style, values);
    case 'area':
      return areaAppearance(values);
    case 'columns':
      return columnsAppearance(style, values);
    case 'candles':
      return { style, candles: candleAppearanceOf(values) };
    case 'hollowCandles':
      return { style, candles: candleAppearanceOf(values) };
    case 'heikinAshi':
      return { style, candles: candleAppearanceOf(values) };
    case 'baseline':
      return baselineAppearance(values);
  }
}
