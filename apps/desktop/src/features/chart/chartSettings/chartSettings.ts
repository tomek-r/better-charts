import { BAR_STYLES, DEFAULT_BAR_STYLE, isBarStyle, type BarStyle } from '../engine/barStyle/barStyles';
import { EXCHANGE_TIME_ZONE, isKnownChartTimeZone } from '../timeZone/chartTimeZones';
import { BAR_STYLE_SETTINGS } from './barStyleSettings';
import { canvasFields } from './canvasSettings';
import { scalesFields } from './scalesSettings';
import { readSettingValue, sameSettingValue, type ChartSettingField, type ChartSettingValue } from './settingFields';

/** The values one group of fields holds, keyed by field key. */
type SettingValues = Readonly<Record<string, ChartSettingValue>>;

/** The fields a bar type actually sets, keyed by field key. */
export type BarStyleSettingValues = SettingValues;

/** The canvas fields a chart sets, keyed by field key. */
export type CanvasSettingValues = SettingValues;

/** The scales and lines fields a chart sets, keyed by field key. */
export type ScalesSettingValues = SettingValues;

/** The groups of settings a chart keeps as layers of their own, beside its bar style and time zone. */
type SettingsGroupKey = 'canvas' | 'scales';

/** A chart's settings with every bar type's fields, the canvas's and the scales' filled in. */
export interface ChartSettings {
  readonly barStyle: BarStyle;
  readonly timeZone: string;
  readonly barStyles: Readonly<Record<BarStyle, BarStyleSettingValues>>;
  readonly canvas: CanvasSettingValues;
  readonly scales: ScalesSettingValues;
}

/** Sparse settings: only what a stored template or a chart's overrides set. */
export interface ChartSettingsLayer {
  readonly barStyle?: BarStyle;
  readonly timeZone?: string;
  readonly barStyles?: Readonly<Partial<Record<BarStyle, BarStyleSettingValues>>>;
  readonly canvas?: CanvasSettingValues;
  readonly scales?: ScalesSettingValues;
}

type BarStylesByStyle = Readonly<Record<BarStyle, BarStyleSettingValues>>;
type SparseBarStyles = Readonly<Partial<Record<BarStyle, BarStyleSettingValues>>>;
type GroupValues = Readonly<Record<SettingsGroupKey, SettingValues>>;
type SparseGroupValues = Readonly<Partial<Record<SettingsGroupKey, SettingValues>>>;
type MutableGroupValues = { -readonly [Key in SettingsGroupKey]?: SettingValues };
type MutableLayerFields = { -readonly [Key in keyof ChartSettingsLayer]: ChartSettingsLayer[Key] };

/** One group of fields the chart keeps as a layer of its own, such as the fields of its canvas. */
interface SettingsGroup {
  readonly key: SettingsGroupKey;
  readonly fields: readonly ChartSettingField[];
  /** Whether a stored layer may keep the values it read, the group's defaults merged in. */
  readonly keeps?: (values: SettingValues) => boolean;
}

/** The two margins that share the chart's height, and the most they may take of it together. */
const TOP_MARGIN_KEY = 'topMargin';
const BOTTOM_MARGIN_KEY = 'bottomMargin';
const MARGIN_PERCENT_LIMIT = 90;

/** One value per bar style, keyed by the style that names it; `BAR_STYLES` supplies the styles, so none is missed. */
function everyBarStyle(valuesFor: (style: BarStyle) => BarStyleSettingValues): BarStylesByStyle {
  const barStyles: Partial<Record<BarStyle, BarStyleSettingValues>> = {};
  for (const style of BAR_STYLES) {
    barStyles[style] = valuesFor(style);
  }
  // `BAR_STYLES` names every style, so the record now holds a value for each of them.
  return barStyles as BarStylesByStyle;
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

const CANVAS_GROUP: SettingsGroup = {
  key: 'canvas',
  fields: canvasFields(),
  keeps: (canvas) => !marginsLeaveNoHeight(canvas),
};

const SCALES_GROUP: SettingsGroup = { key: 'scales', fields: scalesFields() };

/** Every group the chart resolves and stores, in one table so each is read, merged and diffed the same way. */
const SETTINGS_GROUPS: readonly SettingsGroup[] = [CANVAS_GROUP, SCALES_GROUP];

const CANVAS_DEFAULTS = defaultValues(CANVAS_GROUP.fields);
const SCALES_DEFAULTS = defaultValues(SCALES_GROUP.fields);

/** Every group's defaults, keyed by the group that names them. */
const GROUP_DEFAULTS: GroupValues = { canvas: CANVAS_DEFAULTS, scales: SCALES_DEFAULTS };

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

/** A group's values when a stored layer may keep them; a group it cannot use drops them whole. */
function readGroupValues(group: SettingsGroup, raw: unknown): SettingValues | undefined {
  const values = readSettingValues(group.fields, raw);
  if (values === undefined) {
    return undefined;
  }
  const defaults = GROUP_DEFAULTS[group.key];
  const usable = group.keeps === undefined || group.keeps(mergedValues(defaults, values));
  return usable ? values : undefined;
}

/** One value per group that has one, keyed by the group that names it; a group without values is left out. */
function groupsOf(valuesFor: (group: SettingsGroup) => SettingValues | undefined): SparseGroupValues {
  const groups: MutableGroupValues = {};
  for (const group of SETTINGS_GROUPS) {
    const values = valuesFor(group);
    if (values !== undefined) {
      groups[group.key] = values;
    }
  }
  return groups;
}

/** The groups a stored value fills: every group whose values read, the rest left out of the layer. */
function readGroups(raw: Readonly<Record<string, unknown>>): SparseGroupValues {
  return groupsOf((group) => readGroupValues(group, raw[group.key]));
}

/** A layer made of the parts that read; the parts that did not read stay out of it. */
function chartSettingsLayer(parts: ChartSettingsLayer, groups: SparseGroupValues): ChartSettingsLayer {
  const layer: MutableLayerFields = { ...groups };
  if (parts.barStyle !== undefined) {
    layer.barStyle = parts.barStyle;
  }
  if (parts.timeZone !== undefined) {
    layer.timeZone = parts.timeZone;
  }
  if (parts.barStyles !== undefined) {
    layer.barStyles = parts.barStyles;
  }
  return layer;
}

/** Each group's values with a layer's over them, every group merged by the same rule. */
function mergedGroups(settings: ChartSettings, layer: ChartSettingsLayer): GroupValues {
  return { canvas: mergedValues(settings.canvas, layer.canvas), scales: mergedValues(settings.scales, layer.scales) };
}

function withLayer(settings: ChartSettings, layer: ChartSettingsLayer): ChartSettings {
  return {
    barStyle: layer.barStyle ?? settings.barStyle,
    timeZone: layer.timeZone ?? settings.timeZone,
    barStyles: everyBarStyle((style) => mergedValues(settings.barStyles[style], layer.barStyles?.[style])),
    ...mergedGroups(settings, layer),
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

/** Only the groups `edited` changes of `base`, each by the same per-field rule. */
function changedGroups(base: ChartSettings, edited: ChartSettings): SparseGroupValues {
  return groupsOf((group) => changedValues(base[group.key], edited[group.key]));
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  barStyle: DEFAULT_BAR_STYLE,
  timeZone: EXCHANGE_TIME_ZONE,
  barStyles: everyBarStyle((style) => defaultValues(BAR_STYLE_SETTINGS[style].fields)),
  ...GROUP_DEFAULTS,
};

/** The stored layer, keeping the fields that fit and dropping everything this build cannot show. */
export function readChartSettingsLayer(raw: unknown): ChartSettingsLayer {
  if (!isSettingsRecord(raw)) {
    return {};
  }
  return chartSettingsLayer(
    {
      barStyle: readBarStyleName(raw.barStyle),
      timeZone: readTimeZoneName(raw.timeZone),
      barStyles: readSparseBarStyles(raw.barStyles),
    },
    readGroups(raw),
  );
}

/** The default template with every layer applied in order; a later layer wins per field. */
export function resolveChartSettings(layers: readonly ChartSettingsLayer[]): ChartSettings {
  return layers.reduce(withLayer, DEFAULT_CHART_SETTINGS);
}

/** Only what `edited` changes of `base`, as a layer a chart can store. */
export function chartSettingsOverrides(base: ChartSettings, edited: ChartSettings): ChartSettingsLayer {
  return chartSettingsLayer(
    {
      barStyle: base.barStyle === edited.barStyle ? undefined : edited.barStyle,
      timeZone: base.timeZone === edited.timeZone ? undefined : edited.timeZone,
      barStyles: changedBarStyles(base.barStyles, edited.barStyles),
    },
    changedGroups(base, edited),
  );
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

export function withScalesValue(settings: ChartSettings, key: string, value: ChartSettingValue): ChartSettings {
  return { ...settings, scales: { ...settings.scales, [key]: value } };
}

export function withBarStyle(settings: ChartSettings, barStyle: BarStyle): ChartSettings {
  return { ...settings, barStyle };
}

export function withTimeZone(settings: ChartSettings, timeZone: string): ChartSettings {
  return { ...settings, timeZone };
}
