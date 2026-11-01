import { BAR_STYLES, DEFAULT_BAR_STYLE, isBarStyle, type BarStyle } from '../engine/barStyle/barStyles';
import { EXCHANGE_TIME_ZONE, isKnownChartTimeZone } from '../timeZone/chartTimeZones';
import { BAR_STYLE_SETTINGS } from './barStyleSettings';
import { readSettingValue, sameSettingValue, type ChartSettingValue } from './settingFields';

/** The fields a bar type actually sets, keyed by field key. */
export type BarStyleSettingValues = Readonly<Record<string, ChartSettingValue>>;

/** A chart's settings with every bar type's fields filled in. */
export interface ChartSettings {
  readonly barStyle: BarStyle;
  readonly timeZone: string;
  readonly barStyles: Readonly<Record<BarStyle, BarStyleSettingValues>>;
}

/** Sparse settings: only what a stored template or a chart's overrides set. */
export interface ChartSettingsLayer {
  readonly barStyle?: BarStyle;
  readonly timeZone?: string;
  readonly barStyles?: Readonly<Partial<Record<BarStyle, BarStyleSettingValues>>>;
}

type BarStylesByStyle = Readonly<Record<BarStyle, BarStyleSettingValues>>;
type SparseBarStyles = Readonly<Partial<Record<BarStyle, BarStyleSettingValues>>>;
type MutableLayerFields = { -readonly [Key in keyof ChartSettingsLayer]: ChartSettingsLayer[Key] };

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

function defaultSettingValues(style: BarStyle): BarStyleSettingValues {
  const defaults: Record<string, ChartSettingValue> = {};
  for (const field of BAR_STYLE_SETTINGS[style].fields) {
    defaults[field.key] = field.defaultValue;
  }
  return defaults;
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

function readSettingValues(style: BarStyle, raw: unknown): BarStyleSettingValues | undefined {
  if (!isSettingsRecord(raw)) {
    return undefined;
  }
  const values: Record<string, ChartSettingValue> = {};
  for (const field of BAR_STYLE_SETTINGS[style].fields) {
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
    const values = readSettingValues(style, raw[style]);
    if (values !== undefined) {
      barStyles[style] = values;
    }
  }
  return undefinedWhenEmpty(barStyles);
}

function chartSettingsLayer(
  barStyle: BarStyle | undefined,
  timeZone: string | undefined,
  barStyles: SparseBarStyles | undefined,
): ChartSettingsLayer {
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
  return layer;
}

function mergedSettingValues(
  base: BarStyleSettingValues,
  layer: BarStyleSettingValues | undefined,
): BarStyleSettingValues {
  return layer === undefined ? base : { ...base, ...layer };
}

function withLayer(settings: ChartSettings, layer: ChartSettingsLayer): ChartSettings {
  return {
    barStyle: layer.barStyle ?? settings.barStyle,
    timeZone: layer.timeZone ?? settings.timeZone,
    barStyles: everyBarStyle((style) => mergedSettingValues(settings.barStyles[style], layer.barStyles?.[style])),
  };
}

function changedSettingValues(
  base: BarStyleSettingValues,
  edited: BarStyleSettingValues,
): BarStyleSettingValues | undefined {
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
    const values = changedSettingValues(base[style], edited[style]);
    if (values !== undefined) {
      overrides[style] = values;
    }
  }
  return undefinedWhenEmpty(overrides);
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  barStyle: DEFAULT_BAR_STYLE,
  timeZone: EXCHANGE_TIME_ZONE,
  barStyles: everyBarStyle(defaultSettingValues),
};

/** The stored layer, keeping the fields that fit and dropping everything this build cannot show. */
export function readChartSettingsLayer(raw: unknown): ChartSettingsLayer {
  if (!isSettingsRecord(raw)) {
    return {};
  }
  return chartSettingsLayer(
    readBarStyleName(raw.barStyle),
    readTimeZoneName(raw.timeZone),
    readSparseBarStyles(raw.barStyles),
  );
}

/** The default template with every layer applied in order; a later layer wins per field. */
export function resolveChartSettings(layers: readonly ChartSettingsLayer[]): ChartSettings {
  return layers.reduce(withLayer, DEFAULT_CHART_SETTINGS);
}

/** Only what `edited` changes of `base`, as a layer a chart can store. */
export function chartSettingsOverrides(base: ChartSettings, edited: ChartSettings): ChartSettingsLayer {
  const barStyle = base.barStyle === edited.barStyle ? undefined : edited.barStyle;
  const timeZone = base.timeZone === edited.timeZone ? undefined : edited.timeZone;
  return chartSettingsLayer(barStyle, timeZone, changedBarStyles(base.barStyles, edited.barStyles));
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

export function withTimeZone(settings: ChartSettings, timeZone: string): ChartSettings {
  return { ...settings, timeZone };
}
