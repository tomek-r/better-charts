import { BAR_STYLES, DEFAULT_BAR_STYLE, isBarStyle, type BarStyle } from '../engine/barStyle/barStyles';
import { EXCHANGE_TIME_ZONE, isKnownChartTimeZone } from '../timeZone/chartTimeZones';
import { BAR_STYLE_SETTINGS } from './barStyleSettings';
import { canvasFields } from './canvasSettings';
import { readSettingValue, sameSettingValue, type ChartSettingField, type ChartSettingValue } from './settingFields';

/** The values one group of fields holds, keyed by field key. */
export type SettingValues = Readonly<Record<string, ChartSettingValue>>;

/** The fields a bar type actually sets, keyed by field key. */
export type BarStyleSettingValues = SettingValues;

/** The canvas fields a chart sets, keyed by field key. */
export type CanvasSettingValues = SettingValues;

/** A chart's settings with every bar type's fields and the canvas's filled in. */
export interface ChartSettings {
  readonly barStyle: BarStyle;
  readonly timeZone: string;
  readonly barStyles: Readonly<Record<BarStyle, BarStyleSettingValues>>;
  readonly canvas: CanvasSettingValues;
}

/** Sparse settings: only what a stored template or a chart's overrides set. */
export interface ChartSettingsLayer {
  readonly barStyle?: BarStyle;
  readonly timeZone?: string;
  readonly barStyles?: Readonly<Partial<Record<BarStyle, BarStyleSettingValues>>>;
  readonly canvas?: CanvasSettingValues;
}

type BarStylesByStyle = Readonly<Record<BarStyle, BarStyleSettingValues>>;
type SparseBarStyles = Readonly<Partial<Record<BarStyle, BarStyleSettingValues>>>;
type MutableLayerFields = { -readonly [Key in keyof ChartSettingsLayer]: ChartSettingsLayer[Key] };

/** The two margins that share the chart's height, and the most they may take of it together. */
const TOP_MARGIN_KEY = 'topMargin';
const BOTTOM_MARGIN_KEY = 'bottomMargin';
const MARGIN_PERCENT_LIMIT = 90;

function everyBarStyle(valuesFor: (style: BarStyle) => BarStyleSettingValues): BarStylesByStyle {
  return {
    bars: valuesFor('bars'),
    candles: valuesFor('candles'),
    hollowCandles: valuesFor('hollowCandles'),
    line: valuesFor('line'),
    lineWithMarkers: valuesFor('lineWithMarkers'),
    stepLine: valuesFor('stepLine'),
    area: valuesFor('area'),
    baseline: valuesFor('baseline'),
    columns: valuesFor('columns'),
    heikinAshi: valuesFor('heikinAshi'),
  };
}

/** Every field's default, which is what a group of settings starts from. */
function defaultValues(fields: readonly ChartSettingField[]): SettingValues {
  const defaults: Record<string, ChartSettingValue> = {};
  for (const field of fields) {
    defaults[field.key] = field.defaultValue;
  }
  return defaults;
}

/** A group's settings with a layer's values over them; a later layer wins per field. */
function mergedValues(base: SettingValues, layer: SettingValues | undefined): SettingValues {
  return layer === undefined ? base : { ...base, ...layer };
}

function isSettingsRecord(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function readBarStyleName(raw: unknown): BarStyle | undefined {
  return isBarStyle(raw) ? raw : undefined;
}

function readTimeZoneName(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || !isKnownChartTimeZone(raw)) {
    return undefined;
  }
  return raw;
}

/** What read nothing is left out of its layer, so an empty entry never travels. */
function undefinedWhenEmpty<Fields extends object>(fields: Fields): Fields | undefined {
  return Object.keys(fields).length === 0 ? undefined : fields;
}

/** The values `raw` holds that fit their fields; a field that does not read is left out. */
function readSettingValues(fields: readonly ChartSettingField[], raw: unknown): SettingValues | undefined {
  if (!isSettingsRecord(raw)) {
    return undefined;
  }
  const values: Record<string, ChartSettingValue> = {};
  for (const field of fields) {
    const value = readSettingValue(field, raw[field.key]);
    if (value !== undefined) {
      values[field.key] = value;
    }
  }
  return undefinedWhenEmpty(values);
}

function readSparseBarStyles(raw: unknown): SparseBarStyles | undefined {
  if (!isSettingsRecord(raw)) {
    return undefined;
  }
  const barStyles: Partial<Record<BarStyle, BarStyleSettingValues>> = {};
  for (const style of BAR_STYLES) {
    const values = readSettingValues(BAR_STYLE_SETTINGS[style].fields, raw[style]);
    if (values !== undefined) {
      barStyles[style] = values;
    }
  }
  return undefinedWhenEmpty(barStyles);
}

const CANVAS_FIELDS = canvasFields();
const CANVAS_DEFAULTS = defaultValues(CANVAS_FIELDS);

function marginPercent(values: SettingValues, key: string): number {
  const value = values[key];
  return typeof value === 'number' ? value : 0;
}

/** Whether the margins take so much of the height that the chart's bars have no room left. */
function marginsLeaveNoHeight(canvas: SettingValues): boolean {
  const top = marginPercent(canvas, TOP_MARGIN_KEY);
  const bottom = marginPercent(canvas, BOTTOM_MARGIN_KEY);
  return top + bottom >= MARGIN_PERCENT_LIMIT;
}

/** The canvas values a stored layer sets, dropped whole when its margins would leave the bars no height. */
function readCanvasValues(raw: unknown): CanvasSettingValues | undefined {
  const values = readSettingValues(CANVAS_FIELDS, raw);
  if (values === undefined) {
    return undefined;
  }
  return marginsLeaveNoHeight(mergedValues(CANVAS_DEFAULTS, values)) ? undefined : values;
}

/** A layer made of the parts that read; the parts that did not read stay out of it. */
function chartSettingsLayer({ barStyle, timeZone, barStyles, canvas }: ChartSettingsLayer): ChartSettingsLayer {
  const layer: MutableLayerFields = {};
  if (barStyle !== undefined) {
    layer.barStyle = barStyle;
  }
  if (timeZone !== undefined) {
    layer.timeZone = timeZone;
  }
  if (barStyles !== undefined) {
    layer.barStyles = barStyles;
  }
  if (canvas !== undefined) {
    layer.canvas = canvas;
  }
  return layer;
}

function withLayer(settings: ChartSettings, layer: ChartSettingsLayer): ChartSettings {
  return {
    barStyle: layer.barStyle ?? settings.barStyle,
    timeZone: layer.timeZone ?? settings.timeZone,
    barStyles: everyBarStyle((style) => mergedValues(settings.barStyles[style], layer.barStyles?.[style])),
    canvas: mergedValues(settings.canvas, layer.canvas),
  };
}

/** Only the values `edited` changes of `base`, as the sparse layer of one group of settings. */
function changedValues(base: SettingValues, edited: SettingValues): SettingValues | undefined {
  const overrides: Record<string, ChartSettingValue> = {};
  for (const [key, value] of Object.entries(edited)) {
    const baseValue = base[key];
    if (baseValue !== undefined && sameSettingValue(baseValue, value)) {
      continue;
    }
    overrides[key] = value;
  }
  return undefinedWhenEmpty(overrides);
}

function changedBarStyles(base: BarStylesByStyle, edited: BarStylesByStyle): SparseBarStyles | undefined {
  const overrides: Partial<Record<BarStyle, BarStyleSettingValues>> = {};
  for (const style of BAR_STYLES) {
    const values = changedValues(base[style], edited[style]);
    if (values !== undefined) {
      overrides[style] = values;
    }
  }
  return undefinedWhenEmpty(overrides);
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  barStyle: DEFAULT_BAR_STYLE,
  timeZone: EXCHANGE_TIME_ZONE,
  barStyles: everyBarStyle((style) => defaultValues(BAR_STYLE_SETTINGS[style].fields)),
  canvas: CANVAS_DEFAULTS,
};

/** The stored layer, keeping the fields that fit and dropping everything this build cannot show. */
export function readChartSettingsLayer(raw: unknown): ChartSettingsLayer {
  if (!isSettingsRecord(raw)) {
    return {};
  }
  return chartSettingsLayer({
    barStyle: readBarStyleName(raw.barStyle),
    timeZone: readTimeZoneName(raw.timeZone),
    barStyles: readSparseBarStyles(raw.barStyles),
    canvas: readCanvasValues(raw.canvas),
  });
}

/** The default template with every layer applied in order; a later layer wins per field. */
export function resolveChartSettings(layers: readonly ChartSettingsLayer[]): ChartSettings {
  return layers.reduce(withLayer, DEFAULT_CHART_SETTINGS);
}

/** Only what `edited` changes of `base`, as a layer a chart can store. */
export function chartSettingsOverrides(base: ChartSettings, edited: ChartSettings): ChartSettingsLayer {
  return chartSettingsLayer({
    barStyle: base.barStyle === edited.barStyle ? undefined : edited.barStyle,
    timeZone: base.timeZone === edited.timeZone ? undefined : edited.timeZone,
    barStyles: changedBarStyles(base.barStyles, edited.barStyles),
    canvas: changedValues(base.canvas, edited.canvas),
  });
}

export function withSettingValue(
  settings: ChartSettings,
  style: BarStyle,
  key: string,
  value: ChartSettingValue,
): ChartSettings {
  const valuesOfStyle = (barStyle: BarStyle): BarStyleSettingValues => {
    const values = settings.barStyles[barStyle];
    return barStyle === style ? { ...values, [key]: value } : values;
  };
  return { ...settings, barStyles: everyBarStyle(valuesOfStyle) };
}

export function withCanvasValue(settings: ChartSettings, key: string, value: ChartSettingValue): ChartSettings {
  return { ...settings, canvas: { ...settings.canvas, [key]: value } };
}

export function withTimeZone(settings: ChartSettings, timeZone: string): ChartSettings {
  return { ...settings, timeZone };
}
