import { BID_ASK_DRAWING_MODES, type BidAskDrawingMode } from '../engine/surface/chartScalesAppearance';
import { parseHexColor } from '../../../shared/theme/hexColor';
import type { LineDashStyle } from '../../../shared/ui/colorPicker/LinePreview';

/** The body and border colours of rising and falling price. */
export type ColorPairValue = {
  readonly up: string;
  readonly down: string;
};

/** A colour pair a checkbox turns on and off, such as a candle's body. */
export type ToggledColorPairValue = {
  readonly visible: boolean;
  readonly up: string;
  readonly down: string;
};

/** A line a setting draws: its colour and the pattern it is dashed in. */
export type LineValue = {
  readonly color: string;
  readonly style: LineDashStyle;
};

/** A line a checkbox draws and hides, such as a grid line. */
export type ToggledLineValue = {
  readonly visible: boolean;
  readonly color: string;
  readonly style: LineDashStyle;
};

/** The ways a background fill is painted: in one colour, or in two blended from the top down. */
export const BACKGROUND_FILL_MODES = ['solid', 'gradient'] as const;

export type BackgroundFillMode = (typeof BACKGROUND_FILL_MODES)[number];

/** A fill drawn in one colour, or as a gradient from its top colour to its bottom one. */
export type BackgroundFillValue = {
  readonly mode: BackgroundFillMode;
  readonly color: string;
  readonly bottomColor: string;
};

/** What a quote scale draws of its bid and ask: line and label, line, label, or nothing. */
export const QUOTE_LINE_MODES = BID_ASK_DRAWING_MODES;

export type QuoteLineMode = BidAskDrawingMode;

/** The bid and ask lines of the price scale: what is drawn of them, and each one's colour. */
export type QuoteLinesValue = {
  readonly mode: QuoteLineMode;
  readonly bid: string;
  readonly ask: string;
};

/** Text drawn in a colour at a size in pixels, such as the numbers of a scale. */
export type TextStyleValue = {
  readonly color: string;
  readonly fontSize: number;
};

/** The dash patterns a line can be drawn with. */
export const LINE_DASH_STYLES: readonly LineDashStyle[] = ['solid', 'dashed', 'dotted'];

/** The sizes text can be drawn at, in pixels. */
export const TEXT_FONT_SIZES: readonly number[] = [10, 11, 12, 13, 14, 16, 18, 20];

/** The whole numbers a field holds, bounds included. */
export type NumberRange = {
  readonly min: number;
  readonly max: number;
};

/** The whole percents a percent field holds. */
export const PERCENT_RANGE: NumberRange = { min: 0, max: 100 };

/** The whole counts a bar count field holds, such as the bars kept to the right of the last bar. */
export const BAR_COUNT_RANGE: NumberRange = { min: 0, max: 50 };

/** Any value a declared field can hold. */
export type ChartSettingValue =
  | boolean
  | number
  | string
  | ColorPairValue
  | ToggledColorPairValue
  | LineValue
  | ToggledLineValue
  | BackgroundFillValue
  | QuoteLinesValue
  | TextStyleValue;

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

interface SettingFieldIdentity {
  readonly key: string;
  readonly label: string;
}

/** What a row that holds a whole number shows after it, e.g. "%" or "bars". */
interface NumberFieldUnit {
  readonly unit?: string;
}

export interface CheckboxSettingField extends SettingFieldIdentity {
  readonly kind: 'checkbox';
  readonly defaultValue: boolean;
}

export interface ToggledColorPairSettingField extends SettingFieldIdentity {
  readonly kind: 'toggledColorPair';
  readonly defaultValue: ToggledColorPairValue;
}

export interface ColorPairSettingField extends SettingFieldIdentity {
  readonly kind: 'colorPair';
  readonly defaultValue: ColorPairValue;
}

export interface ColorSettingField extends SettingFieldIdentity {
  readonly kind: 'color';
  readonly defaultValue: string;
}

export interface LineWidthSettingField extends SettingFieldIdentity {
  readonly kind: 'lineWidth';
  readonly defaultValue: number;
}

export interface ToggledLineSettingField extends SettingFieldIdentity {
  readonly kind: 'toggledLine';
  readonly defaultValue: ToggledLineValue;
}

export interface LineSettingField extends SettingFieldIdentity {
  readonly kind: 'line';
  readonly defaultValue: LineValue;
}

export interface BackgroundFillSettingField extends SettingFieldIdentity {
  readonly kind: 'backgroundFill';
  readonly defaultValue: BackgroundFillValue;
}

export interface QuoteLinesSettingField extends SettingFieldIdentity {
  readonly kind: 'quoteLines';
  readonly defaultValue: QuoteLinesValue;
}

export interface TextStyleSettingField extends SettingFieldIdentity {
  readonly kind: 'textStyle';
  readonly defaultValue: TextStyleValue;
}

export interface ChoiceSettingField extends SettingFieldIdentity {
  readonly kind: 'choice';
  readonly defaultValue: string;
  readonly options: readonly ChoiceOption[];
}

export interface PercentSettingField extends SettingFieldIdentity, NumberFieldUnit {
  readonly kind: 'percent';
  readonly defaultValue: number;
}

export interface BarCountSettingField extends SettingFieldIdentity, NumberFieldUnit {
  readonly kind: 'barCount';
  readonly defaultValue: number;
}

/** One row of a settings dialog, declaring the value it holds. */
export type ChartSettingField =
  | CheckboxSettingField
  | ToggledColorPairSettingField
  | ColorPairSettingField
  | ColorSettingField
  | LineWidthSettingField
  | ToggledLineSettingField
  | LineSettingField
  | BackgroundFillSettingField
  | QuoteLinesSettingField
  | TextStyleSettingField
  | ChoiceSettingField
  | PercentSettingField
  | BarCountSettingField;

/** A titled group of fields, which a settings panel draws as one caption above their rows. */
export interface SettingsSectionFields {
  readonly title: string;
  readonly fields: readonly ChartSettingField[];
}

type SettingKind = ChartSettingField['kind'];

/** The whole pixel widths a line field can name. */
const LINE_WIDTH_RANGE: NumberRange = { min: 1, max: 4 };

const COLOR_PAIR_KEYS = ['up', 'down'];
const TOGGLED_COLOR_PAIR_KEYS = ['visible', 'up', 'down'];
const LINE_KEYS = ['color', 'style'];
const TOGGLED_LINE_KEYS = ['visible', 'color', 'style'];
const BACKGROUND_FILL_KEYS = ['mode', 'color', 'bottomColor'];
const QUOTE_LINES_KEYS = ['mode', 'bid', 'ask'];
const TEXT_STYLE_KEYS = ['color', 'fontSize'];

function readBoolean(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

function readColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  return parseHexColor(raw) === undefined ? undefined : raw;
}

function readIntegerInRange(raw: unknown, range: NumberRange): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < range.min || raw > range.max) {
    return undefined;
  }
  return raw;
}

function readLineWidth(raw: unknown): number | undefined {
  return readIntegerInRange(raw, LINE_WIDTH_RANGE);
}

function readPercent(raw: unknown): number | undefined {
  return readIntegerInRange(raw, PERCENT_RANGE);
}

function readBarCount(raw: unknown): number | undefined {
  return readIntegerInRange(raw, BAR_COUNT_RANGE);
}

function readChoice(raw: unknown, options: readonly ChoiceOption[]): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  return options.some((option) => option.value === raw) ? raw : undefined;
}

function readDashStyle(raw: unknown): LineDashStyle | undefined {
  return LINE_DASH_STYLES.find((style) => style === raw);
}

function readFillMode(raw: unknown): BackgroundFillMode | undefined {
  return BACKGROUND_FILL_MODES.find((mode) => mode === raw);
}

function readQuoteLineMode(raw: unknown): QuoteLineMode | undefined {
  return QUOTE_LINE_MODES.find((mode) => mode === raw);
}

function readFontSize(raw: unknown): number | undefined {
  return TEXT_FONT_SIZES.find((size) => size === raw);
}

function hasExactKeys(raw: unknown, expectedKeys: readonly string[]): raw is Readonly<Record<string, unknown>> {
  if (typeof raw !== 'object' || raw === null) {
    return false;
  }
  const actualKeys = Object.keys(raw);
  if (actualKeys.length !== expectedKeys.length) {
    return false;
  }
  return expectedKeys.every((key) => actualKeys.includes(key));
}

function readColors(record: Readonly<Record<string, unknown>>): ColorPairValue | undefined {
  const up = readColor(record.up);
  const down = readColor(record.down);
  if (up === undefined || down === undefined) {
    return undefined;
  }
  return { up, down };
}

function readColorPair(raw: unknown): ColorPairValue | undefined {
  return hasExactKeys(raw, COLOR_PAIR_KEYS) ? readColors(raw) : undefined;
}

function readToggledColorPair(raw: unknown): ToggledColorPairValue | undefined {
  if (!hasExactKeys(raw, TOGGLED_COLOR_PAIR_KEYS)) {
    return undefined;
  }
  const visible = readBoolean(raw.visible);
  const colors = readColors(raw);
  if (visible === undefined || colors === undefined) {
    return undefined;
  }
  return { visible, ...colors };
}

function readLineParts(record: Readonly<Record<string, unknown>>): LineValue | undefined {
  const color = readColor(record.color);
  const style = readDashStyle(record.style);
  if (color === undefined || style === undefined) {
    return undefined;
  }
  return { color, style };
}

function readLine(raw: unknown): LineValue | undefined {
  return hasExactKeys(raw, LINE_KEYS) ? readLineParts(raw) : undefined;
}

function readToggledLine(raw: unknown): ToggledLineValue | undefined {
  if (!hasExactKeys(raw, TOGGLED_LINE_KEYS)) {
    return undefined;
  }
  const visible = readBoolean(raw.visible);
  const line = readLineParts(raw);
  if (visible === undefined || line === undefined) {
    return undefined;
  }
  return { visible, ...line };
}

function readBackgroundFill(raw: unknown): BackgroundFillValue | undefined {
  if (!hasExactKeys(raw, BACKGROUND_FILL_KEYS)) {
    return undefined;
  }
  const mode = readFillMode(raw.mode);
  const color = readColor(raw.color);
  const bottomColor = readColor(raw.bottomColor);
  if (mode === undefined || color === undefined || bottomColor === undefined) {
    return undefined;
  }
  return { mode, color, bottomColor };
}

function readQuoteLines(raw: unknown): QuoteLinesValue | undefined {
  if (!hasExactKeys(raw, QUOTE_LINES_KEYS)) {
    return undefined;
  }
  const mode = readQuoteLineMode(raw.mode);
  const bid = readColor(raw.bid);
  const ask = readColor(raw.ask);
  if (mode === undefined || bid === undefined || ask === undefined) {
    return undefined;
  }
  return { mode, bid, ask };
}

function readTextStyle(raw: unknown): TextStyleValue | undefined {
  if (!hasExactKeys(raw, TEXT_STYLE_KEYS)) {
    return undefined;
  }
  const color = readColor(raw.color);
  const fontSize = readFontSize(raw.fontSize);
  if (color === undefined || fontSize === undefined) {
    return undefined;
  }
  return { color, fontSize };
}

type SettingValueReader = (raw: unknown) => ChartSettingValue | undefined;

/** Whether a value is the fill a background row edits: the mode it names and the two colours it paints between. */
export function isBackgroundFillValue(value: unknown): value is BackgroundFillValue {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('mode' in value) || !('color' in value) || !('bottomColor' in value)) {
    return false;
  }
  return readFillMode(value.mode) !== undefined;
}

/** One reader per kind; `choice` is read separately because it needs the field's options. */
const SETTING_VALUE_READERS: Readonly<Record<Exclude<SettingKind, 'choice'>, SettingValueReader>> = {
  checkbox: readBoolean,
  toggledColorPair: readToggledColorPair,
  colorPair: readColorPair,
  color: readColor,
  lineWidth: readLineWidth,
  toggledLine: readToggledLine,
  line: readLine,
  backgroundFill: readBackgroundFill,
  quoteLines: readQuoteLines,
  textStyle: readTextStyle,
  percent: readPercent,
  barCount: readBarCount,
};

/** The value `raw` holds if it fits the field's kind, undefined when it does not. */
export function readSettingValue(field: ChartSettingField, raw: unknown): ChartSettingValue | undefined {
  if (field.kind === 'choice') {
    return readChoice(raw, field.options);
  }
  return SETTING_VALUE_READERS[field.kind](raw);
}

/** Equality of two object values, field by field. */
function sameObjectValue(first: Readonly<Record<string, unknown>>, second: Readonly<Record<string, unknown>>): boolean {
  const keys = Object.keys(first);
  if (keys.length !== Object.keys(second).length) {
    return false;
  }
  return keys.every((key) => first[key] === second[key]);
}

/** Equality that looks inside the object kinds, so a reloaded copy matches the value it came from. */
export function sameSettingValue(first: ChartSettingValue, second: ChartSettingValue): boolean {
  if (typeof first !== 'object' || typeof second !== 'object') {
    return first === second;
  }
  return sameObjectValue(first, second);
}
