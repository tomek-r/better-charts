import type { ChartFootprintRowSize } from '../../../shared/bridge/types';
import type {
  FootprintImbalanceHighlight,
  FootprintStackedImbalance,
  ToggledColor,
  VolumeFootprintAppearance,
} from '../engine/barStyle/barStyleAppearance';
import {
  FOOTPRINT_DEFAULT_BUY_SHADES,
  FOOTPRINT_DEFAULT_DISPLAY,
  FOOTPRINT_DEFAULT_GRADIENT,
  FOOTPRINT_DEFAULT_IMBALANCE_HIGHLIGHT,
  FOOTPRINT_DEFAULT_POC,
  FOOTPRINT_DEFAULT_ROW_SIZE_MODE,
  FOOTPRINT_DEFAULT_SELL_SHADES,
  FOOTPRINT_DEFAULT_SHOW_SUMMARY,
  FOOTPRINT_DEFAULT_SHOW_VALUE_AREA,
  FOOTPRINT_DEFAULT_STACKED_IMBALANCE,
  FOOTPRINT_DEFAULT_TYPE,
  FOOTPRINT_DEFAULT_VALUES,
} from '../engine/barStyle/volumeFootprint/footprintDefaults';
import {
  FOOTPRINT_DISPLAYS,
  FOOTPRINT_ROW_SIZE_MODES,
  FOOTPRINT_TYPES,
  FOOTPRINT_VALUES,
} from '../engine/barStyle/volumeFootprint/footprintModes';
import { candleAppearanceOf } from './candleAppearanceSetting';
import type { BarStyleSettingValues } from './chartSettings';
import { isSettingRecord, readBoolean, readColor, readNumber, readOption } from './settingValueReaders';
import {
  ATR_LENGTH_FIELD,
  ATR_LENGTH_KEY,
  BUY_SHADES_KEY,
  DISPLAY_KEY,
  GRADIENT_KEY,
  IMBALANCE_HIGHLIGHT_KEY,
  IMBALANCE_PERCENT_FIELD,
  IMBALANCE_PERCENT_KEY,
  POC_KEY,
  ROW_SIZE_MODE_KEY,
  SELL_SHADES_KEY,
  SHOW_SUMMARY_KEY,
  SHOW_VALUE_AREA_KEY,
  STACKED_LEVEL_COUNT_KEY,
  STACKED_LEVELS_KEY,
  TICKS_PER_ROW_FIELD,
  TICKS_PER_ROW_KEY,
  TYPE_KEY,
  VALUE_AREA_PERCENT_FIELD,
  VALUE_AREA_PERCENT_KEY,
  VALUES_KEY,
} from './volumeFootprintSettings';

/** The two colours a highlight row stores, as the appearance names them: the up side buys, the down side sells. */
function readHighlight(raw: unknown): FootprintImbalanceHighlight {
  const fallback = FOOTPRINT_DEFAULT_IMBALANCE_HIGHLIGHT;
  if (!isSettingRecord(raw)) {
    return fallback;
  }
  return {
    visible: readBoolean(raw.visible, fallback.visible),
    buyColor: readColor(raw.up, fallback.buyColor),
    sellColor: readColor(raw.down, fallback.sellColor),
  };
}

/** How many levels a stacked zone collects, and whether such zones are drawn. */
function readStackedImbalance(values: BarStyleSettingValues): FootprintStackedImbalance {
  const fallback = FOOTPRINT_DEFAULT_STACKED_IMBALANCE;
  return {
    visible: readBoolean(values[STACKED_LEVELS_KEY], fallback.visible),
    count: readNumber(values[STACKED_LEVEL_COUNT_KEY], fallback.count),
  };
}

/** The colour the row a bar traded most at is drawn in, and whether it takes that colour. */
function readPoc(raw: unknown): ToggledColor {
  const fallback = FOOTPRINT_DEFAULT_POC;
  if (!isSettingRecord(raw)) {
    return fallback;
  }
  return {
    visible: readBoolean(raw.visible, fallback.visible),
    color: readColor(raw.color, fallback.color),
  };
}

/** The four shades a side's cells are graded through, each unreadable colour keeping the default in its place. */
function readShades(raw: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(raw)) {
    return fallback;
  }
  return fallback.map((defaultColor, index) => readColor(raw[index], defaultColor));
}

/** The row width the host is asked for, read off the row size mode and the two numbers it keeps. */
function readRowSize(values: BarStyleSettingValues): ChartFootprintRowSize {
  const mode = readOption(values[ROW_SIZE_MODE_KEY], FOOTPRINT_ROW_SIZE_MODES, FOOTPRINT_DEFAULT_ROW_SIZE_MODE);
  const ticksPerRow = readNumber(values[TICKS_PER_ROW_KEY], TICKS_PER_ROW_FIELD.defaultValue);
  const atrLength = readNumber(values[ATR_LENGTH_KEY], ATR_LENGTH_FIELD.defaultValue);
  if (mode === 'manual') {
    return { kind: 'manual', ticksPerRow };
  }
  return { kind: 'auto', atrLength };
}

/** The volume footprint appearance the style draws, which also says what the host is asked to compute its rows with. */
export function volumeFootprintAppearance(values: BarStyleSettingValues): VolumeFootprintAppearance {
  return {
    style: 'volumeFootprint',
    candles: candleAppearanceOf(values),
    rowSize: readRowSize(values),
    valueAreaPercent: readNumber(values[VALUE_AREA_PERCENT_KEY], VALUE_AREA_PERCENT_FIELD.defaultValue),
    showValueArea: readBoolean(values[SHOW_VALUE_AREA_KEY], FOOTPRINT_DEFAULT_SHOW_VALUE_AREA),
    imbalancePercent: readNumber(values[IMBALANCE_PERCENT_KEY], IMBALANCE_PERCENT_FIELD.defaultValue),
    gradient: readBoolean(values[GRADIENT_KEY], FOOTPRINT_DEFAULT_GRADIENT),
    display: readOption(values[DISPLAY_KEY], FOOTPRINT_DISPLAYS, FOOTPRINT_DEFAULT_DISPLAY),
    type: readOption(values[TYPE_KEY], FOOTPRINT_TYPES, FOOTPRINT_DEFAULT_TYPE),
    values: readOption(values[VALUES_KEY], FOOTPRINT_VALUES, FOOTPRINT_DEFAULT_VALUES),
    sellShades: readShades(values[SELL_SHADES_KEY], FOOTPRINT_DEFAULT_SELL_SHADES),
    buyShades: readShades(values[BUY_SHADES_KEY], FOOTPRINT_DEFAULT_BUY_SHADES),
    showSummary: readBoolean(values[SHOW_SUMMARY_KEY], FOOTPRINT_DEFAULT_SHOW_SUMMARY),
    imbalanceHighlight: readHighlight(values[IMBALANCE_HIGHLIGHT_KEY]),
    stackedImbalance: readStackedImbalance(values),
    poc: readPoc(values[POC_KEY]),
  };
}
