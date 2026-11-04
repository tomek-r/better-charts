import { palette } from '../../../shared/theme/palette';
import { barStyleLabel, type BarStyle } from '../engine/barStyle/barStyles';
import type {
  ChartSettingField,
  CheckboxSettingField,
  ChoiceSettingField,
  ColorPairSettingField,
  ColorSettingField,
  LineWidthSettingField,
  SettingsSectionFields,
  ToggledColorPairSettingField,
  ToggledColorSettingField,
} from './settingFields';

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

function settingsSection(style: BarStyle, fields: readonly ChartSettingField[]): BarStyleSettingsSection {
  return { title: barStyleLabel(style), fields };
}

/** What each bar style's settings dialog draws. */
export const BAR_STYLE_SETTINGS: Readonly<Record<BarStyle, BarStyleSettingsSection>> = {
  bars: settingsSection('bars', BARS_FIELDS),
  candles: settingsSection('candles', CANDLE_FIELDS),
  hollowCandles: settingsSection('hollowCandles', CANDLE_FIELDS),
  volumeCandles: settingsSection('volumeCandles', CANDLE_FIELDS),
  line: settingsSection('line', LINE_FIELDS),
  lineWithMarkers: settingsSection('lineWithMarkers', LINE_FIELDS),
  stepLine: settingsSection('stepLine', LINE_FIELDS),
  area: settingsSection('area', AREA_FIELDS),
  baseline: settingsSection('baseline', BASELINE_FIELDS),
  columns: settingsSection('columns', COLUMNS_FIELDS),
  highLow: settingsSection('highLow', HIGH_LOW_FIELDS),
  heikinAshi: settingsSection('heikinAshi', CANDLE_FIELDS),
};
