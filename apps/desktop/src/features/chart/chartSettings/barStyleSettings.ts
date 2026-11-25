import { palette } from '../../../shared/theme/palette';
import { KAGI_DEFAULT_OPTIONS } from '../engine/barStyle/kagi/kagiOptions';
import { POINT_FIGURE_DEFAULT_OPTIONS } from '../engine/barStyle/pointFigure/pointFigureOptions';
import { barStyleLabel, type BarStyle } from '../engine/barStyle/barStyles';
import type {
  ChartSettingField,
  CheckboxSettingField,
  ChoiceSettingField,
  ColorPairSettingField,
  ColorSettingField,
  DecimalSettingField,
  LineWidthSettingField,
  PercentSettingField,
  SettingsSectionFields,
  ToggledColorPairSettingField,
  ToggledColorSettingField,
} from './settingFields';
import {
  FOOTPRINT_IMBALANCE_FIELDS,
  FOOTPRINT_LABELS_FIELDS,
  FOOTPRINT_SECTION_TITLES,
  FOOTPRINT_VOLUME_FIELDS,
  VOLUME_FOOTPRINT_FIELDS,
} from './volumeFootprintSettings';

type BarStyleSettingsSection = SettingsSectionFields;

const COLOR_BY_PREVIOUS_CLOSE_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: 'colorByPreviousClose',
  label: 'Color bars based on previous close',
  defaultValue: false,
};

const COLORS_FIELD: ColorPairSettingField = {
  kind: 'colorPair',
  key: 'colors',
  label: 'Colors',
  defaultValue: { up: palette.up, down: palette.sell },
};

const BODY_FIELD: ToggledColorPairSettingField = {
  kind: 'toggledColorPair',
  key: 'body',
  label: 'Body',
  defaultValue: { visible: true, up: palette.up, down: palette.sell },
};

const BORDERS_FIELD: ToggledColorPairSettingField = {
  kind: 'toggledColorPair',
  key: 'borders',
  label: 'Borders',
  defaultValue: { visible: false, up: palette.up, down: palette.sell },
};

const WICK_FIELD: ToggledColorPairSettingField = {
  kind: 'toggledColorPair',
  key: 'wick',
  label: 'Wick',
  defaultValue: { visible: true, up: palette.up, down: palette.sell },
};

/**
 * How far the quietest visible body narrows against the busiest one, as the whole percent the dialog shows: the
 * default 80 % leaves the quietest visible bar a fifth of the full body width.
 */
export const WIDTH_SENSITIVITY_FIELD: PercentSettingField = {
  kind: 'percent',
  key: 'widthSensitivity',
  label: 'Width sensitivity',
  defaultValue: 80,
  unit: '%',
};

const HIGH_LOW_BODY_FIELD: ToggledColorSettingField = {
  kind: 'toggledColor',
  key: 'body',
  label: 'Body',
  defaultValue: { visible: true, color: palette.info },
};

const HIGH_LOW_BORDERS_FIELD: ToggledColorSettingField = {
  kind: 'toggledColor',
  key: 'borders',
  label: 'Borders',
  defaultValue: { visible: true, color: palette.info },
};

const HIGH_LOW_LABELS_FIELD: ToggledColorSettingField = {
  kind: 'toggledColor',
  key: 'labels',
  label: 'Labels',
  defaultValue: { visible: true, color: palette.info },
};

const PRICE_SOURCE_FIELD: ChoiceSettingField = {
  kind: 'choice',
  key: 'priceSource',
  label: 'Price source',
  defaultValue: 'close',
  options: [
    { value: 'open', label: 'Open' },
    { value: 'high', label: 'High' },
    { value: 'low', label: 'Low' },
    { value: 'close', label: 'Close' },
    { value: 'hl2', label: '(H + L)/2' },
    { value: 'hlc3', label: '(H + L + C)/3' },
    { value: 'ohlc4', label: '(O + H + L + C)/4' },
  ],
};

const LINE_COLOR_FIELD: ColorSettingField = {
  kind: 'color',
  key: 'lineColor',
  label: 'Line',
  defaultValue: palette.info,
};

const LINE_WIDTH_FIELD: LineWidthSettingField = {
  kind: 'lineWidth',
  key: 'lineWidth',
  label: 'Line width',
  defaultValue: 2,
};

const CANDLE_FIELDS: readonly ChartSettingField[] = [
  COLOR_BY_PREVIOUS_CLOSE_FIELD,
  BODY_FIELD,
  BORDERS_FIELD,
  WICK_FIELD,
];

/** The candles' own fields, and how far the quietest body on screen narrows against the busiest one. */
const VOLUME_CANDLES_FIELDS: readonly ChartSettingField[] = [...CANDLE_FIELDS, WIDTH_SENSITIVITY_FIELD];

/** The volume footprint's own fields: the colours of the thin candle its bars draw, then every footprint row. */
const VOLUME_FOOTPRINT_ALL_FIELDS: readonly ChartSettingField[] = [...CANDLE_FIELDS, ...VOLUME_FOOTPRINT_FIELDS];

const BARS_FIELDS: readonly ChartSettingField[] = [
  COLOR_BY_PREVIOUS_CLOSE_FIELD,
  COLORS_FIELD,
  { kind: 'checkbox', key: 'thinBars', label: 'Thin bars', defaultValue: true },
  { kind: 'checkbox', key: 'hlcBars', label: 'HLC bars', defaultValue: false },
];

const LINE_FIELDS: readonly ChartSettingField[] = [PRICE_SOURCE_FIELD, LINE_COLOR_FIELD, LINE_WIDTH_FIELD];

const AREA_FIELDS: readonly ChartSettingField[] = [
  PRICE_SOURCE_FIELD,
  LINE_COLOR_FIELD,
  LINE_WIDTH_FIELD,
  { kind: 'color', key: 'fillTop', label: 'Fill top', defaultValue: palette.infoWash },
  { kind: 'color', key: 'fillBottom', label: 'Fill bottom', defaultValue: palette.infoClear },
];

const BASELINE_FIELDS: readonly ChartSettingField[] = [
  PRICE_SOURCE_FIELD,
  { kind: 'percent', key: 'baseLevel', label: 'Base level', defaultValue: 50 },
  { kind: 'color', key: 'topLine', label: 'Top line', defaultValue: palette.up },
  { kind: 'color', key: 'topFill', label: 'Top fill', defaultValue: palette.upWash },
  { kind: 'color', key: 'bottomLine', label: 'Bottom line', defaultValue: palette.sell },
  { kind: 'color', key: 'bottomFill', label: 'Bottom fill', defaultValue: palette.sellWashStrong },
  LINE_WIDTH_FIELD,
];

const COLUMNS_FIELDS: readonly ChartSettingField[] = [COLOR_BY_PREVIOUS_CLOSE_FIELD, COLORS_FIELD];

const HIGH_LOW_FIELDS: readonly ChartSettingField[] = [
  HIGH_LOW_BODY_FIELD,
  HIGH_LOW_BORDERS_FIELD,
  HIGH_LOW_LABELS_FIELD,
];

/**
 * How a chart type sizes the move it measures, in TradingView's order and wording: by the ATR until told
 * otherwise, by a fixed amount, or by a share of the last close.
 */
function moveSizeMethodField(key: string, label: string): ChoiceSettingField {
  return {
    kind: 'choice',
    key,
    label,
    defaultValue: 'atr',
    options: [
      { value: 'atr', label: 'ATR' },
      { value: 'traditional', label: 'Traditional' },
      { value: 'percentageLtp', label: 'Percentage LTP' },
    ],
  };
}

/** Which setting sizes a Renko brick or a Point & figure box, in TradingView's order and wording. */
const BOX_METHOD_FIELD: ChoiceSettingField = moveSizeMethodField('boxMethod', 'Box size assignment method');

/** Bars of the average true range one box spans: TradingView's own default length. */
const ATR_LENGTH_FIELD: DecimalSettingField = {
  kind: 'decimal',
  key: 'atrLength',
  label: 'ATR length',
  defaultValue: 14,
  range: { min: 1, max: 1000, step: 1 },
};

/** The price distance a Renko brick spans, which only the traditional method reads. */
const BOX_SIZE_FIELD: DecimalSettingField = {
  kind: 'decimal',
  key: 'boxSize',
  label: 'Box size',
  defaultValue: 10,
  range: { min: 0.00001, max: 1_000_000, step: 0.00001 },
};

/** The share of the last close one box spans, which only the percentage method reads. */
const PERCENTAGE_OF_CLOSE_FIELD: DecimalSettingField = {
  kind: 'decimal',
  key: 'percentage',
  label: 'Percentage',
  defaultValue: 1,
  unit: '%',
  range: { min: 0.001, max: 100, step: 0.001 },
};

const WICKS_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: 'wicks',
  label: 'Wicks',
  defaultValue: true,
};

/** How many lines the close turns against before a Line Break line is drawn. */
const LINE_BREAK_LINES_FIELD: DecimalSettingField = {
  kind: 'decimal',
  key: 'lines',
  label: 'Number of lines',
  defaultValue: 3,
  range: { min: 1, max: 100, step: 1 },
};

/** How a Kagi line sizes the move that turns it, in TradingView's order and wording. */
const REVERSAL_METHOD_FIELD: ChoiceSettingField = moveSizeMethodField(
  'reversalMethod',
  'Reversal amount assignment method',
);

/** The price distance a Kagi line turns by, which only the traditional method reads. */
const REVERSAL_AMOUNT_FIELD: DecimalSettingField = {
  kind: 'decimal',
  key: 'reversal',
  label: 'Reversal amount',
  defaultValue: 1,
  range: { min: 0.00001, max: 1_000_000, step: 0.00001 },
};

/** The thick style a Kagi line takes once it rises above the previous shoulder. */
const YANG_COLOR_FIELD: ColorSettingField = {
  kind: 'color',
  key: 'yangColor',
  label: 'Yang',
  defaultValue: KAGI_DEFAULT_OPTIONS.yangColor,
};

const YANG_WIDTH_FIELD: LineWidthSettingField = {
  kind: 'lineWidth',
  key: 'yangLineWidth',
  label: 'Yang line width',
  defaultValue: KAGI_DEFAULT_OPTIONS.yangLineWidth,
};

/** The thin style a Kagi line takes once it falls below the previous waist. */
const YIN_COLOR_FIELD: ColorSettingField = {
  kind: 'color',
  key: 'yinColor',
  label: 'Yin',
  defaultValue: KAGI_DEFAULT_OPTIONS.yinColor,
};

const YIN_WIDTH_FIELD: LineWidthSettingField = {
  kind: 'lineWidth',
  key: 'yinLineWidth',
  label: 'Yin line width',
  defaultValue: KAGI_DEFAULT_OPTIONS.yinLineWidth,
};

const RENKO_FIELDS: readonly ChartSettingField[] = [
  BOX_METHOD_FIELD,
  ATR_LENGTH_FIELD,
  BOX_SIZE_FIELD,
  PERCENTAGE_OF_CLOSE_FIELD,
  WICKS_FIELD,
  ...CANDLE_FIELDS,
];

/** A line has no wick to draw, so its section offers the body and border colours alone. */
const LINE_BREAK_FIELDS: readonly ChartSettingField[] = [
  LINE_BREAK_LINES_FIELD,
  COLOR_BY_PREVIOUS_CLOSE_FIELD,
  BODY_FIELD,
  BORDERS_FIELD,
];

/** A Kagi line is drawn in its own two styles rather than in the chart's candle colours. */
const KAGI_FIELDS: readonly ChartSettingField[] = [
  REVERSAL_METHOD_FIELD,
  ATR_LENGTH_FIELD,
  REVERSAL_AMOUNT_FIELD,
  PERCENTAGE_OF_CLOSE_FIELD,
  YANG_COLOR_FIELD,
  YANG_WIDTH_FIELD,
  YIN_COLOR_FIELD,
  YIN_WIDTH_FIELD,
];

/** Which prices a Point & figure column reads, in TradingView's order and wording. */
const POINT_FIGURE_SOURCE_FIELD: ChoiceSettingField = {
  kind: 'choice',
  key: 'source',
  label: 'Source',
  defaultValue: 'highLow',
  options: [
    { value: 'highLow', label: 'High/Low' },
    { value: 'close', label: 'Close' },
  ],
};

/** The price distance one Point & figure box spans, which only the traditional method reads. */
const POINT_FIGURE_BOX_SIZE_FIELD: DecimalSettingField = {
  kind: 'decimal',
  key: 'boxSize',
  label: 'Box size',
  defaultValue: 1,
  range: { min: 0.00001, max: 1_000_000, step: 0.00001 },
};

/** How many boxes against a column the price has to travel before the opposite column is drawn. */
const POINT_FIGURE_REVERSAL_FIELD: DecimalSettingField = {
  kind: 'decimal',
  key: 'reversal',
  label: 'Reversal amount',
  defaultValue: 3,
  range: { min: 1, max: 1000, step: 1 },
};

/** The colour a rising Point & figure column's X marks are drawn in. */
const POINT_FIGURE_UP_COLOR_FIELD: ColorSettingField = {
  kind: 'color',
  key: 'upColor',
  label: 'Up color',
  defaultValue: POINT_FIGURE_DEFAULT_OPTIONS.upColor,
};

/** The colour a falling Point & figure column's O marks are drawn in. */
const POINT_FIGURE_DOWN_COLOR_FIELD: ColorSettingField = {
  kind: 'color',
  key: 'downColor',
  label: 'Down color',
  defaultValue: POINT_FIGURE_DEFAULT_OPTIONS.downColor,
};

/** Point & figure prints its own marks rather than the chart's candles, so its section offers its two colours. */
const POINT_FIGURE_FIELDS: readonly ChartSettingField[] = [
  POINT_FIGURE_SOURCE_FIELD,
  BOX_METHOD_FIELD,
  ATR_LENGTH_FIELD,
  POINT_FIGURE_BOX_SIZE_FIELD,
  PERCENTAGE_OF_CLOSE_FIELD,
  POINT_FIGURE_REVERSAL_FIELD,
  POINT_FIGURE_UP_COLOR_FIELD,
  POINT_FIGURE_DOWN_COLOR_FIELD,
];

function settingsSection(style: BarStyle, fields: readonly ChartSettingField[]): BarStyleSettingsSection {
  return { title: barStyleLabel(style), fields };
}

/** What each bar style's settings dialog draws. */
export const BAR_STYLE_SETTINGS: Readonly<Record<BarStyle, BarStyleSettingsSection>> = {
  bars: settingsSection('bars', BARS_FIELDS),
  candles: settingsSection('candles', CANDLE_FIELDS),
  hollowCandles: settingsSection('hollowCandles', CANDLE_FIELDS),
  volumeCandles: settingsSection('volumeCandles', VOLUME_CANDLES_FIELDS),
  volumeFootprint: settingsSection('volumeFootprint', VOLUME_FOOTPRINT_ALL_FIELDS),
  line: settingsSection('line', LINE_FIELDS),
  lineWithMarkers: settingsSection('lineWithMarkers', LINE_FIELDS),
  stepLine: settingsSection('stepLine', LINE_FIELDS),
  area: settingsSection('area', AREA_FIELDS),
  baseline: settingsSection('baseline', BASELINE_FIELDS),
  columns: settingsSection('columns', COLUMNS_FIELDS),
  highLow: settingsSection('highLow', HIGH_LOW_FIELDS),
  heikinAshi: settingsSection('heikinAshi', CANDLE_FIELDS),
  renko: settingsSection('renko', RENKO_FIELDS),
  lineBreak: settingsSection('lineBreak', LINE_BREAK_FIELDS),
  kagi: settingsSection('kagi', KAGI_FIELDS),
  pointFigure: settingsSection('pointFigure', POINT_FIGURE_FIELDS),
};

/** The footprint's three groups: the candle rows and its own settings, then its imbalance and label rows. */
const VOLUME_FOOTPRINT_SECTIONS: readonly BarStyleSettingsSection[] = [
  { title: FOOTPRINT_SECTION_TITLES[0], fields: [...CANDLE_FIELDS, ...FOOTPRINT_VOLUME_FIELDS] },
  { title: FOOTPRINT_SECTION_TITLES[1], fields: FOOTPRINT_IMBALANCE_FIELDS },
  { title: FOOTPRINT_SECTION_TITLES[2], fields: FOOTPRINT_LABELS_FIELDS },
];

/** The sections a style's settings dialog draws, in order: the footprint's three groups, or its one section. */
export function barStyleSettingSections(style: BarStyle): readonly BarStyleSettingsSection[] {
  return style === 'volumeFootprint' ? VOLUME_FOOTPRINT_SECTIONS : [BAR_STYLE_SETTINGS[style]];
}
