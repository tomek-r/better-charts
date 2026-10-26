import { timeframeOptions } from '../../../../shared/bridge/timeframes';

/**
 * The settings schema of one drawing, modelled on Pine Script v6's `input.*` functions: a
 * definition states what to ask the user for, which value to start from and how a stored
 * value is checked. The engine stores and forwards values; the tool owns its schema.
 */

/** The chart series a `source` input may name, in Pine Script's `input.source` order. */
export const TOOL_INPUT_SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'] as const;

export type ToolInputSource = (typeof TOOL_INPUT_SOURCES)[number];

/** Fields every input carries, whatever its kind and value type. */
interface ToolInputCommon<Kind extends string, Value> {
  readonly kind: Kind;
  readonly id: string;
  readonly title: string;
  readonly defaultValue: Value;
  readonly group?: string;
  readonly tooltip?: string;
}

/** Bounds the two numeric kinds may carry; both optional, so a one-sided range is allowed. */
interface ToolInputNumberBounds {
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly step?: number;
}

/** Pine Script `input.int`: a whole number. */
export type ToolInputInt = ToolInputCommon<'int', number> & ToolInputNumberBounds;

/** Pine Script `input.float`: a decimal number. */
export type ToolInputFloat = ToolInputCommon<'float', number> & ToolInputNumberBounds;

/** Pine Script `input.bool`: a checkbox. */
export type ToolInputBool = ToolInputCommon<'bool', boolean>;

/** Pine Script `input.string`: a text field, or a drop-down when `options` is given. */
export interface ToolInputString extends ToolInputCommon<'string', string> {
  readonly options?: readonly string[];
}

/** Pine Script `input.text_area`: a multi-line text field. */
export type ToolInputTextArea = ToolInputCommon<'textArea', string>;

/** Pine Script `input.color`: an `#RRGGBB` or `#RRGGBBAA` colour. */
export type ToolInputColor = ToolInputCommon<'color', string>;

/** Pine Script `input.source`: one of the chart's price series. */
export type ToolInputSourceChoice = ToolInputCommon<'source', ToolInputSource>;

/** Pine Script `input.timeframe`: a wire code from `config/timeframes.json`. */
export type ToolInputTimeframe = ToolInputCommon<'timeframe', string>;

/** Pine Script `input.symbol`: a symbol name. */
export type ToolInputSymbol = ToolInputCommon<'symbol', string>;

/** Pine Script `input.session`: a `HHMM-HHMM` window with optional `:1234567` weekdays. */
export type ToolInputSession = ToolInputCommon<'session', string>;

/** Pine Script `input.price`: a chart price, display-only and never an order input. */
export type ToolInputPrice = ToolInputCommon<'price', number>;

/** Pine Script `input.time`: an instant in epoch milliseconds. */
export type ToolInputTime = ToolInputCommon<'time', number>;

/** One choice of an `enum` input. */
export interface ToolInputEnumOption {
  readonly value: string;
  readonly title: string;
}

/** Pine Script `input.enum`: one of the given choices. */
export interface ToolInputEnum extends ToolInputCommon<'enum', string> {
  readonly options: readonly ToolInputEnumOption[];
}

/** Every kind of setting a drawing may carry; `kind` says which one this is. */
export type ToolInputDefinition =
  | ToolInputInt
  | ToolInputFloat
  | ToolInputBool
  | ToolInputString
  | ToolInputTextArea
  | ToolInputColor
  | ToolInputSourceChoice
  | ToolInputTimeframe
  | ToolInputSymbol
  | ToolInputSession
  | ToolInputPrice
  | ToolInputTime
  | ToolInputEnum;

/** One stored value; a value never nests. */
export type ToolInputValue = number | boolean | string;

/** Every stored value of one drawing, keyed by input id. */
export type ToolInputValues = Readonly<Record<string, ToolInputValue>>;

const COLOR_PATTERN = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const SESSION_PATTERN = /^\d{4}-\d{4}(:[1-7]{1,7})?$/;
const TIMEFRAME_WIRES: ReadonlySet<string> = new Set(timeframeOptions.map(({ wire }) => wire));
const SOURCE_VALUES: ReadonlySet<string> = new Set(TOOL_INPUT_SOURCES);

/** A plain record: an object that is neither null nor an array. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isToolInputValue(value: unknown): value is ToolInputValue {
  return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string';
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

function isNumberInBounds({ minValue, maxValue }: ToolInputNumberBounds, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return false;
  }
  return (minValue === undefined || value >= minValue) && (maxValue === undefined || value <= maxValue);
}

function isIntegerInBounds(definition: ToolInputInt, value: unknown): boolean {
  return isFiniteInteger(value) && isNumberInBounds(definition, value);
}

function isStringInOptions(options: readonly string[] | undefined, value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return options === undefined || options.includes(value);
}

/** The shape of one validator once the union of definitions is behind it. */
type ToolInputValidator = (definition: ToolInputDefinition, value: unknown) => boolean;

/** One validator per kind; each reads only the fields its own definition carries. */
type ToolInputValidatorTable = {
  readonly [Kind in ToolInputDefinition['kind']]: (
    definition: Extract<ToolInputDefinition, { kind: Kind }>,
    value: unknown,
  ) => boolean;
};

/**
 * The single place a kind's rule lives, so adding a kind is one variant above and one
 * entry here. `isValidToolInputValue` is the one crossing from the union to a single entry.
 */
const TOOL_INPUT_VALIDATORS = {
  int: (definition: ToolInputInt, value: unknown) => isIntegerInBounds(definition, value),
  float: (definition: ToolInputFloat, value: unknown) => isNumberInBounds(definition, value),
  bool: (_definition: ToolInputBool, value: unknown) => typeof value === 'boolean',
  string: (definition: ToolInputString, value: unknown) => isStringInOptions(definition.options, value),
  textArea: (_definition: ToolInputTextArea, value: unknown) => typeof value === 'string',
  color: (_definition: ToolInputColor, value: unknown) => typeof value === 'string' && COLOR_PATTERN.test(value),
  source: (_definition: ToolInputSourceChoice, value: unknown) => typeof value === 'string' && SOURCE_VALUES.has(value),
  timeframe: (_definition: ToolInputTimeframe, value: unknown) =>
    typeof value === 'string' && TIMEFRAME_WIRES.has(value),
  symbol: (_definition: ToolInputSymbol, value: unknown) => typeof value === 'string' && value.trim().length > 0,
  session: (_definition: ToolInputSession, value: unknown) => typeof value === 'string' && SESSION_PATTERN.test(value),
  price: (_definition: ToolInputPrice, value: unknown) => typeof value === 'number' && Number.isFinite(value),
  time: (_definition: ToolInputTime, value: unknown) => isFiniteInteger(value),
  enum: (definition: ToolInputEnum, value: unknown) => definition.options.some((option) => option.value === value),
} satisfies ToolInputValidatorTable;

/** Whether `value` is a legal value for this definition's kind. */
export function isValidToolInputValue(definition: ToolInputDefinition, value: unknown): value is ToolInputValue {
  // The table is keyed by kind, so its indexed type is the union of every entry.
  const validate = TOOL_INPUT_VALIDATORS[definition.kind] as ToolInputValidator;
  return validate(definition, value);
}

/** Shape check for a whole settings map: a plain record whose values are input values. */
export function isToolInputValues(value: unknown): value is ToolInputValues {
  return isPlainRecord(value) && Object.values(value).every(isToolInputValue);
}

/**
 * The settings to work from: each definition's stored value when it is valid, its default
 * otherwise. A stored key without a definition is dropped, and a `stored` value that is not
 * a record at all yields every default.
 */
export function resolveToolInputValues(definitions: readonly ToolInputDefinition[], stored: unknown): ToolInputValues {
  const storedValues: Record<string, unknown> = isPlainRecord(stored) ? stored : {};
  return Object.fromEntries(
    definitions.map((definition): [string, ToolInputValue] => {
      const storedValue = storedValues[definition.id];
      const value = isValidToolInputValue(definition, storedValue) ? storedValue : definition.defaultValue;
      return [definition.id, value];
    }),
  );
}

/** Every definition's default value, keyed by input id: what nothing stored resolves to. */
export function defaultToolInputValues(definitions: readonly ToolInputDefinition[]): ToolInputValues {
  return resolveToolInputValues(definitions, undefined);
}
