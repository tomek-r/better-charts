import { timeframeOptions } from '../../../../shared/bridge/timeframes';

// The settings schema of one drawing, modelled on Pine Script v6's `input.*` functions: a
// definition states what to ask the user for, which value to start from and how a stored
// value is checked. The engine stores and forwards values; the tool owns its schema. The input
// kinds follow Pine Script v6 `input.*`, and both drawing tools and indicators declare their
// settings in them.

/** The chart series a `source` input may name, in Pine Script's `input.source` order. */
export const SETTING_INPUT_SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'] as const;

export type SettingInputSource = (typeof SETTING_INPUT_SOURCES)[number];

/** Pine Script v6 `active`, declarative: the input is editable while another input holds one value. */
export interface SettingInputActiveWhen {
  readonly inputId: string;
  readonly equals: SettingValue;
}

/** Fields every input carries, whatever its kind and value type. */
interface SettingInputCommon<Kind extends string, Value> {
  readonly kind: Kind;
  readonly id: string;
  readonly title: string;
  readonly defaultValue: Value;
  readonly group?: string;
  readonly tooltip?: string;
  /** Pine Script v6 `inline`: inputs sharing one key sit in one row, in declaration order. */
  readonly inline?: string;
  /** Pine Script v6 `active`: disabled, with its value kept, while the other input differs. */
  readonly activeWhen?: SettingInputActiveWhen;
}

/** Bounds the two numeric kinds may carry; both optional, so a one-sided range is allowed. */
interface SettingInputNumberBounds {
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly step?: number;
}

/** Pine Script `input.int`: a whole number. */
export type SettingInputInt = SettingInputCommon<'int', number> & SettingInputNumberBounds;

/** Pine Script `input.float`: a decimal number. */
export type SettingInputFloat = SettingInputCommon<'float', number> & SettingInputNumberBounds;

/** Pine Script `input.bool`: a checkbox. */
export type SettingInputBool = SettingInputCommon<'bool', boolean>;

/** Pine Script `input.string`: a text field, or a drop-down when `options` is given. */
export interface SettingInputString extends SettingInputCommon<'string', string> {
  readonly options?: readonly string[];
}

/** Pine Script `input.text_area`: a multi-line text field. */
export type SettingInputTextArea = SettingInputCommon<'textArea', string>;

/** Pine Script `input.color`: an `#RRGGBB` or `#RRGGBBAA` colour. */
export type SettingInputColor = SettingInputCommon<'color', string>;

/** Pine Script `input.source`: one of the chart's price series. */
export type SettingInputSourceChoice = SettingInputCommon<'source', SettingInputSource>;

/** Pine Script `input.timeframe`: a wire code from `config/timeframes.json`. */
export type SettingInputTimeframe = SettingInputCommon<'timeframe', string>;

/** Pine Script `input.symbol`: a symbol name. */
export type SettingInputSymbol = SettingInputCommon<'symbol', string>;

/** Pine Script `input.session`: a `HHMM-HHMM` window with optional `:1234567` weekdays. */
export type SettingInputSession = SettingInputCommon<'session', string>;

/** Pine Script `input.price`: a chart price, display-only and never an order input. */
export type SettingInputPrice = SettingInputCommon<'price', number>;

/** Pine Script `input.time`: an instant in epoch milliseconds. */
export type SettingInputTime = SettingInputCommon<'time', number>;

/** One choice of an `enum` input. */
export interface SettingInputEnumOption {
  readonly value: string;
  readonly title: string;
}

/** Pine Script `input.enum`: one of the given choices. */
export interface SettingInputEnum extends SettingInputCommon<'enum', string> {
  readonly options: readonly SettingInputEnumOption[];
}

/** Every kind of setting a drawing may carry; `kind` says which one this is. */
export type SettingInputDefinition =
  | SettingInputInt
  | SettingInputFloat
  | SettingInputBool
  | SettingInputString
  | SettingInputTextArea
  | SettingInputColor
  | SettingInputSourceChoice
  | SettingInputTimeframe
  | SettingInputSymbol
  | SettingInputSession
  | SettingInputPrice
  | SettingInputTime
  | SettingInputEnum;

/** One stored value; a value never nests. */
export type SettingValue = number | boolean | string;

/** Every stored value of one drawing, keyed by input id. */
export type SettingValues = Readonly<Record<string, SettingValue>>;

const COLOR_PATTERN = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const SESSION_PATTERN = /^\d{4}-\d{4}(:[1-7]{1,7})?$/;
const TIMEFRAME_WIRES: ReadonlySet<string> = new Set(timeframeOptions.map(({ wire }) => wire));
const SOURCE_VALUES: ReadonlySet<string> = new Set(SETTING_INPUT_SOURCES);

/** A plain record: an object that is neither null nor an array. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSettingValue(value: unknown): value is SettingValue {
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string';
}

export function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/** Whether `value` is an `#RRGGBB` or `#RRGGBBAA` colour. */
export function isColorText(value: unknown): value is string {
  return typeof value === 'string' && COLOR_PATTERN.test(value);
}

export function isNumberInBounds({ minValue, maxValue }: SettingInputNumberBounds, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }
  return (minValue === undefined || value >= minValue) && (maxValue === undefined || value <= maxValue);
}

function isIntegerInBounds(definition: SettingInputInt, value: unknown): boolean {
  return isFiniteInteger(value) && isNumberInBounds(definition, value);
}

function isStringInOptions(options: readonly string[] | undefined, value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return options === undefined || options.includes(value);
}

/** The shape of one validator once the union of definitions is behind it. */
type SettingInputValidator = (definition: SettingInputDefinition, value: unknown) => boolean;

/** One validator per kind; each reads only the fields its own definition carries. */
type SettingInputValidatorTable = {
  readonly [Kind in SettingInputDefinition['kind']]: (
    definition: Extract<SettingInputDefinition, { kind: Kind }>,
    value: unknown,
  ) => boolean;
};

/**
 * The single place a kind's rule lives, so adding a kind is one variant above and one
 * entry here. `isValidSettingInputValue` is the one crossing from the union to a single entry.
 */
const SETTING_INPUT_VALIDATORS = {
  int: (definition: SettingInputInt, value: unknown) => isIntegerInBounds(definition, value),
  float: (definition: SettingInputFloat, value: unknown) => isNumberInBounds(definition, value),
  bool: (_definition: SettingInputBool, value: unknown) => typeof value === 'boolean',
  string: (definition: SettingInputString, value: unknown) => isStringInOptions(definition.options, value),
  textArea: (_definition: SettingInputTextArea, value: unknown) => typeof value === 'string',
  color: (_definition: SettingInputColor, value: unknown) => isColorText(value),
  source: (_definition: SettingInputSourceChoice, value: unknown) =>
    typeof value === 'string' && SOURCE_VALUES.has(value),
  timeframe: (_definition: SettingInputTimeframe, value: unknown) =>
    typeof value === 'string' && TIMEFRAME_WIRES.has(value),
  symbol: (_definition: SettingInputSymbol, value: unknown) => typeof value === 'string' && value.trim().length > 0,
  session: (_definition: SettingInputSession, value: unknown) =>
    typeof value === 'string' && SESSION_PATTERN.test(value),
  price: (_definition: SettingInputPrice, value: unknown) => typeof value === 'number' && Number.isFinite(value),
  time: (_definition: SettingInputTime, value: unknown) => isFiniteInteger(value),
  enum: (definition: SettingInputEnum, value: unknown) => definition.options.some((option) => option.value === value),
} satisfies SettingInputValidatorTable;

/** Whether `value` is a legal value for this definition's kind. */
export function isValidSettingInputValue(definition: SettingInputDefinition, value: unknown): value is SettingValue {
  // The table is keyed by kind, so its indexed type is the union of every entry.
  const validate = SETTING_INPUT_VALIDATORS[definition.kind] as SettingInputValidator;
  return validate(definition, value);
}

/** Shape check for a whole settings map: a plain record whose values are input values. */
export function isSettingValues(value: unknown): value is SettingValues {
  return isPlainRecord(value) && Object.values(value).every(isSettingValue);
}

/**
 * The settings to work from: each definition's stored value when it is valid, its default
 * otherwise. A stored key without a definition is dropped, and a `stored` value that is not
 * a record at all yields every default.
 */
export function resolveSettingInputValues(
  definitions: readonly SettingInputDefinition[],
  stored: unknown,
): SettingValues {
  const storedValues: Record<string, unknown> = isPlainRecord(stored) ? stored : {};
  return Object.fromEntries(
    definitions.map((definition): [string, SettingValue] => {
      const storedValue = storedValues[definition.id];
      const value = isValidSettingInputValue(definition, storedValue) ? storedValue : definition.defaultValue;
      return [definition.id, value];
    }),
  );
}

/** Whether the input is editable now: it names no condition, or the other input holds the wanted value. */
export function isSettingInputActive(definition: SettingInputDefinition, values: SettingValues): boolean {
  const { activeWhen } = definition;
  return activeWhen === undefined || values[activeWhen.inputId] === activeWhen.equals;
}

/**
 * Whether the input's value stops the form from saving: only an input that is editable now can, because an
 * inactive one is never read and never shown as invalid.
 */
export function isSettingInputInvalid(definition: SettingInputDefinition, values: SettingValues): boolean {
  return isSettingInputActive(definition, values) && !isValidSettingInputValue(definition, values[definition.id]);
}

/** Every definition's default value, keyed by input id: what nothing stored resolves to. */
export function defaultSettingInputValues(definitions: readonly SettingInputDefinition[]): SettingValues {
  return resolveSettingInputValues(definitions, undefined);
}
