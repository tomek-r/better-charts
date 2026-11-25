import {
  FOOTPRINT_DEFAULT_ATR_LENGTH,
  FOOTPRINT_DEFAULT_BUY_SHADES,
  FOOTPRINT_DEFAULT_DISPLAY,
  FOOTPRINT_DEFAULT_GRADIENT,
  FOOTPRINT_DEFAULT_IMBALANCE_HIGHLIGHT,
  FOOTPRINT_DEFAULT_IMBALANCE_PERCENT,
  FOOTPRINT_DEFAULT_POC,
  FOOTPRINT_DEFAULT_ROW_SIZE_MODE,
  FOOTPRINT_DEFAULT_SELL_SHADES,
  FOOTPRINT_DEFAULT_SHOW_SUMMARY,
  FOOTPRINT_DEFAULT_SHOW_VALUE_AREA,
  FOOTPRINT_DEFAULT_STACKED_IMBALANCE,
  FOOTPRINT_DEFAULT_TICKS_PER_ROW,
  FOOTPRINT_DEFAULT_TYPE,
  FOOTPRINT_DEFAULT_VALUE_AREA_PERCENT,
  FOOTPRINT_DEFAULT_VALUES,
} from '../engine/barStyle/volumeFootprint/footprintDefaults';
import {
  FOOTPRINT_DISPLAYS,
  FOOTPRINT_ROW_SIZE_MODES,
  FOOTPRINT_TYPES,
  FOOTPRINT_VALUES,
} from '../engine/barStyle/volumeFootprint/footprintModes';
import type {
  ChartSettingField,
  CheckboxSettingField,
  ChoiceSettingField,
  ColorListSettingField,
  ToggledColorPairSettingField,
  ToggledColorSettingField,
  WholeNumberSettingField,
} from './settingFields';

/** How many bars the automatic row size averages over, and how many ticks one manual row spans. */
const ATR_LENGTH_RANGE = { min: 1, max: 500 };
const TICKS_PER_ROW_RANGE = { min: 1, max: 100_000 };
/** The share of a bar's volume its value area may cover, and the share a row must beat to count as an imbalance. */
const VALUE_AREA_PERCENT_RANGE = { min: 1, max: 100 };
const IMBALANCE_PERCENT_RANGE = { min: 1, max: 1000 };
/** How many levels a stacked zone may collect. */
const STACKED_LEVELS_RANGE = { min: 2, max: 100 };
/** How many shades each side's cells are graded through. */
const SHADE_COUNT = FOOTPRINT_DEFAULT_SELL_SHADES.length;

/** The keys the footprint rows store their values under, which the appearance reads back by. */
export const ROW_SIZE_MODE_KEY = 'rowSizeMode';
export const ATR_LENGTH_KEY = 'atrLength';
export const TICKS_PER_ROW_KEY = 'ticksPerRow';
export const DISPLAY_KEY = 'display';
export const TYPE_KEY = 'type';
export const VALUES_KEY = 'values';
export const GRADIENT_KEY = 'gradient';
export const SELL_SHADES_KEY = 'sellShades';
export const BUY_SHADES_KEY = 'buyShades';
export const SHOW_VALUE_AREA_KEY = 'showValueArea';
export const VALUE_AREA_PERCENT_KEY = 'valueAreaPercent';
export const IMBALANCE_PERCENT_KEY = 'imbalancePercent';
export const IMBALANCE_HIGHLIGHT_KEY = 'imbalanceHighlight';
export const STACKED_LEVELS_KEY = 'stackedImbalance';
export const STACKED_LEVEL_COUNT_KEY = 'stackedLevelCount';
export const POC_KEY = 'poc';
export const SHOW_SUMMARY_KEY = 'showSummary';

/** What each row size, display, type and value option is called in the dialog. */
const ROW_SIZE_LABELS: Readonly<Record<(typeof FOOTPRINT_ROW_SIZE_MODES)[number], string>> = {
  auto: 'Auto (ATR)',
  manual: 'Manual',
};
const DISPLAY_LABELS: Readonly<Record<(typeof FOOTPRINT_DISPLAYS)[number], string>> = {
  cluster: 'Cluster',
  profile: 'Profile',
};
const TYPE_LABELS: Readonly<Record<(typeof FOOTPRINT_TYPES)[number], string>> = {
  buySell: 'Buy and Sell',
  bidAsk: 'Bid × Ask',
  delta: 'Delta',
  total: 'Total',
  ladder: 'Ladder',
};
const VALUES_LABELS: Readonly<Record<(typeof FOOTPRINT_VALUES)[number], string>> = {
  volume: 'Volume',
  tradeCount: 'Trade count',
};

/** One option per value a choice row offers, named by the table above. */
function choiceOptions<Value extends string>(
  values: readonly Value[],
  labels: Readonly<Record<Value, string>>,
): readonly { readonly value: string; readonly label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

const ROW_SIZE_FIELD: ChoiceSettingField = {
  kind: 'choice',
  key: ROW_SIZE_MODE_KEY,
  label: 'Row size',
  defaultValue: FOOTPRINT_DEFAULT_ROW_SIZE_MODE,
  options: choiceOptions(FOOTPRINT_ROW_SIZE_MODES, ROW_SIZE_LABELS),
};

export const ATR_LENGTH_FIELD: WholeNumberSettingField = {
  kind: 'wholeNumber',
  key: ATR_LENGTH_KEY,
  label: 'ATR length',
  defaultValue: FOOTPRINT_DEFAULT_ATR_LENGTH,
  range: ATR_LENGTH_RANGE,
  visibleWhen: { key: ROW_SIZE_MODE_KEY, values: ['auto'] },
};

export const TICKS_PER_ROW_FIELD: WholeNumberSettingField = {
  kind: 'wholeNumber',
  key: TICKS_PER_ROW_KEY,
  label: 'Ticks per row',
  defaultValue: FOOTPRINT_DEFAULT_TICKS_PER_ROW,
  range: TICKS_PER_ROW_RANGE,
  visibleWhen: { key: ROW_SIZE_MODE_KEY, values: ['manual'] },
};

const DISPLAY_FIELD: ChoiceSettingField = {
  kind: 'choice',
  key: DISPLAY_KEY,
  label: 'Display',
  defaultValue: FOOTPRINT_DEFAULT_DISPLAY,
  options: choiceOptions(FOOTPRINT_DISPLAYS, DISPLAY_LABELS),
};

const TYPE_FIELD: ChoiceSettingField = {
  kind: 'choice',
  key: TYPE_KEY,
  label: 'Type',
  defaultValue: FOOTPRINT_DEFAULT_TYPE,
  options: choiceOptions(FOOTPRINT_TYPES, TYPE_LABELS),
};

const VALUES_FIELD: ChoiceSettingField = {
  kind: 'choice',
  key: VALUES_KEY,
  label: 'Values',
  defaultValue: FOOTPRINT_DEFAULT_VALUES,
  options: choiceOptions(FOOTPRINT_VALUES, VALUES_LABELS),
};

const GRADIENT_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: GRADIENT_KEY,
  label: 'Apply gradient to background',
  defaultValue: FOOTPRINT_DEFAULT_GRADIENT,
};

const SELL_SHADES_FIELD: ColorListSettingField = {
  kind: 'colorList',
  key: SELL_SHADES_KEY,
  label: 'Sell background',
  defaultValue: FOOTPRINT_DEFAULT_SELL_SHADES,
  length: SHADE_COUNT,
};

const BUY_SHADES_FIELD: ColorListSettingField = {
  kind: 'colorList',
  key: BUY_SHADES_KEY,
  label: 'Buy background',
  defaultValue: FOOTPRINT_DEFAULT_BUY_SHADES,
  length: SHADE_COUNT,
};

const SHOW_VALUE_AREA_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: SHOW_VALUE_AREA_KEY,
  label: 'Value area',
  defaultValue: FOOTPRINT_DEFAULT_SHOW_VALUE_AREA,
};

export const VALUE_AREA_PERCENT_FIELD: WholeNumberSettingField = {
  kind: 'wholeNumber',
  key: VALUE_AREA_PERCENT_KEY,
  label: 'Value area size',
  defaultValue: FOOTPRINT_DEFAULT_VALUE_AREA_PERCENT,
  range: VALUE_AREA_PERCENT_RANGE,
  unit: '%',
  visibleWhen: { key: SHOW_VALUE_AREA_KEY, values: [true] },
};

export const IMBALANCE_PERCENT_FIELD: WholeNumberSettingField = {
  kind: 'wholeNumber',
  key: IMBALANCE_PERCENT_KEY,
  label: 'Imbalance',
  defaultValue: FOOTPRINT_DEFAULT_IMBALANCE_PERCENT,
  range: IMBALANCE_PERCENT_RANGE,
  unit: '%',
};

/** The pair a highlight row stores: its up side is the buy colour, its down side the sell colour. */
const IMBALANCE_HIGHLIGHT_FIELD: ToggledColorPairSettingField = {
  kind: 'toggledColorPair',
  key: IMBALANCE_HIGHLIGHT_KEY,
  label: 'Highlighting',
  defaultValue: {
    visible: FOOTPRINT_DEFAULT_IMBALANCE_HIGHLIGHT.visible,
    up: FOOTPRINT_DEFAULT_IMBALANCE_HIGHLIGHT.buyColor,
    down: FOOTPRINT_DEFAULT_IMBALANCE_HIGHLIGHT.sellColor,
  },
  colorNames: { up: 'buy', down: 'sell' },
};

const STACKED_LEVELS_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: STACKED_LEVELS_KEY,
  label: 'Stacked levels',
  defaultValue: FOOTPRINT_DEFAULT_STACKED_IMBALANCE.visible,
};

const STACKED_LEVEL_COUNT_FIELD: WholeNumberSettingField = {
  kind: 'wholeNumber',
  key: STACKED_LEVEL_COUNT_KEY,
  label: 'Levels in a stack',
  defaultValue: FOOTPRINT_DEFAULT_STACKED_IMBALANCE.count,
  range: STACKED_LEVELS_RANGE,
  visibleWhen: { key: STACKED_LEVELS_KEY, values: [true] },
};

const POC_FIELD: ToggledColorSettingField = {
  kind: 'toggledColor',
  key: POC_KEY,
  label: 'POC',
  defaultValue: { visible: FOOTPRINT_DEFAULT_POC.visible, color: FOOTPRINT_DEFAULT_POC.color },
};

const SHOW_SUMMARY_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: SHOW_SUMMARY_KEY,
  label: 'Show summary info',
  defaultValue: FOOTPRINT_DEFAULT_SHOW_SUMMARY,
};

/** The footprint's own rows, from the width of its rows down to the value area it marks. */
export const FOOTPRINT_VOLUME_FIELDS: readonly ChartSettingField[] = [
  ROW_SIZE_FIELD,
  ATR_LENGTH_FIELD,
  TICKS_PER_ROW_FIELD,
  DISPLAY_FIELD,
  TYPE_FIELD,
  VALUES_FIELD,
  GRADIENT_FIELD,
  SELL_SHADES_FIELD,
  BUY_SHADES_FIELD,
  SHOW_VALUE_AREA_FIELD,
  VALUE_AREA_PERCENT_FIELD,
];

/** The rows that say which cells count as imbalanced and how they are marked. */
export const FOOTPRINT_IMBALANCE_FIELDS: readonly ChartSettingField[] = [
  IMBALANCE_PERCENT_FIELD,
  IMBALANCE_HIGHLIGHT_FIELD,
  STACKED_LEVELS_FIELD,
  STACKED_LEVEL_COUNT_FIELD,
];

/** The rows that say what a bar writes of its own point of control and its totals. */
export const FOOTPRINT_LABELS_FIELDS: readonly ChartSettingField[] = [POC_FIELD, SHOW_SUMMARY_FIELD];

/** Every footprint row, in the order the dialog lists its three sections. */
export const VOLUME_FOOTPRINT_FIELDS: readonly ChartSettingField[] = [
  ...FOOTPRINT_VOLUME_FIELDS,
  ...FOOTPRINT_IMBALANCE_FIELDS,
  ...FOOTPRINT_LABELS_FIELDS,
];

/** The titles of the footprint's three sections, which the Symbol tab draws under the candle rows. */
export const FOOTPRINT_SECTION_TITLES = ['Volume footprint', 'Imbalance', 'Labels'] as const;
