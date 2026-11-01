import { parseHexColor } from '../../../shared/theme/hexColor';

/** The body and border colours of rising and falling price. */
export interface ColorPairValue {
  readonly up: string;
  readonly down: string;
}

/** A colour pair a checkbox turns on and off, such as a candle's body. */
export interface ToggledColorPairValue {
  readonly visible: boolean;
  readonly up: string;
  readonly down: string;
}

/** Any value a declared field can hold. */
export type ChartSettingValue = boolean | number | string | ColorPairValue | ToggledColorPairValue;

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

interface SettingFieldIdentity {
  readonly key: string;
  readonly label: string;
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

export interface ChoiceSettingField extends SettingFieldIdentity {
  readonly kind: 'choice';
  readonly defaultValue: string;
  readonly options: readonly ChoiceOption[];
}

export interface PercentSettingField extends SettingFieldIdentity {
  readonly kind: 'percent';
  readonly defaultValue: number;
}

/** One row of a bar style's settings dialog, declaring the value it holds. */
export type ChartSettingField =
  | CheckboxSettingField
  | ToggledColorPairSettingField
  | ColorPairSettingField
  | ColorSettingField
  | LineWidthSettingField
  | ChoiceSettingField
  | PercentSettingField;

type SettingKind = ChartSettingField['kind'];

const MIN_LINE_WIDTH = 1;
const MAX_LINE_WIDTH = 4;
const MIN_PERCENT = 0;
const MAX_PERCENT = 100;

const COLOR_PAIR_KEYS = ['up', 'down'];
const TOGGLED_COLOR_PAIR_KEYS = ['visible', 'up', 'down'];

function readBoolean(raw: unknown): boolean | undefined {
  return typeof raw === 'boolean' ? raw : undefined;
}

function readColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  return parseHexColor(raw) === undefined ? undefined : raw;
}

function readIntegerInRange(raw: unknown, min: number, max: number): number | undefined {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    return undefined;
  }
  return raw;
}

function readLineWidth(raw: unknown): number | undefined {
  return readIntegerInRange(raw, MIN_LINE_WIDTH, MAX_LINE_WIDTH);
}

function readPercent(raw: unknown): number | undefined {
  return readIntegerInRange(raw, MIN_PERCENT, MAX_PERCENT);
}

function readChoice(raw: unknown, options: readonly ChoiceOption[]): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  return options.some((option) => option.value === raw) ? raw : undefined;
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
  return { visible, up: colors.up, down: colors.down };
}

type SettingValueReader = (raw: unknown) => ChartSettingValue | undefined;

/** One reader per kind; `choice` is read separately because it needs the field's options. */
const SETTING_VALUE_READERS: Readonly<Record<Exclude<SettingKind, 'choice'>, SettingValueReader>> = {
  checkbox: readBoolean,
  toggledColorPair: readToggledColorPair,
  colorPair: readColorPair,
  color: readColor,
  lineWidth: readLineWidth,
  percent: readPercent,
};

/** The value `raw` holds if it fits the field's kind, undefined when it does not. */
export function readSettingValue(field: ChartSettingField, raw: unknown): ChartSettingValue | undefined {
  if (field.kind === 'choice') {
    return readChoice(raw, field.options);
  }
  return SETTING_VALUE_READERS[field.kind](raw);
}

function isToggledColorPair(value: ColorPairValue | ToggledColorPairValue): value is ToggledColorPairValue {
  return 'visible' in value;
}

function sameColors(first: ColorPairValue, second: ColorPairValue): boolean {
  return first.up === second.up && first.down === second.down;
}

function sameSettingObject(
  first: ColorPairValue | ToggledColorPairValue,
  second: ColorPairValue | ToggledColorPairValue,
): boolean {
  if (isToggledColorPair(first) && isToggledColorPair(second)) {
    return first.visible === second.visible && sameColors(first, second);
  }
  if (isToggledColorPair(first) || isToggledColorPair(second)) {
    return false;
  }
  return sameColors(first, second);
}

/** Equality that looks inside the object kinds, so a reloaded copy matches the value it came from. */
export function sameSettingValue(first: ChartSettingValue, second: ChartSettingValue): boolean {
  if (typeof first !== 'object' || typeof second !== 'object') {
    return first === second;
  }
  return sameSettingObject(first, second);
}
