import {
  isColorText,
  isFiniteInteger,
  isNumberInBounds,
  isPlainRecord,
  type ToolInputValue,
  type ToolInputValues,
} from './toolInputs';

/**
 * The Style tab of one drawing, modelled on what Pine Script's `plot()`, `hline()` and `fill()` expose in
 * TradingView's Style tab. Styles are declared apart from inputs, but a style is stored as scalar values in
 * the same map as the inputs: the store accepts only numbers, booleans and strings, so each style
 * flattens to the keys `toolStyleKey` names.
 */

/** The line widths a `line` style offers, in CSS px. */
export const TOOL_STYLE_LINE_WIDTHS = [1, 2, 3, 4] as const;

/** The dash patterns a `line` style offers. */
export const TOOL_STYLE_LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;

export type ToolStyleLineStyle = (typeof TOOL_STYLE_LINE_STYLES)[number];

const LINE_WIDTH_BOUNDS = {
  minValue: TOOL_STYLE_LINE_WIDTHS[0],
  maxValue: TOOL_STYLE_LINE_WIDTHS[TOOL_STYLE_LINE_WIDTHS.length - 1],
};
const LINE_STYLE_VALUES: ReadonlySet<unknown> = new Set(TOOL_STYLE_LINE_STYLES);

/** Fields every style carries. A child renders under its parent and follows the parent's checkbox. */
interface ToolStyleCommon<Kind extends string> {
  readonly kind: Kind;
  readonly id: string;
  readonly title: string;
  readonly parentId?: string;
}

/** A line: a checkbox, a colour, and a width and dash pattern. */
export interface ToolStyleLine extends ToolStyleCommon<'line'> {
  readonly defaults: {
    readonly visible: boolean;
    readonly color: string;
    readonly width: number;
    readonly style: ToolStyleLineStyle;
  };
}

/** A colour row; it has a checkbox only when its defaults say `visible`. */
export interface ToolStyleColor extends ToolStyleCommon<'color'> {
  readonly defaults: { readonly visible?: boolean; readonly color: string };
}

/** A checkbox-only row, usually the parent of the styles it shows or hides. */
export interface ToolStyleToggle extends ToolStyleCommon<'toggle'> {
  readonly defaults: { readonly visible: boolean };
}

/** A number, bounded and stepped like a Pine `input.int`. */
export interface ToolStyleNumber extends ToolStyleCommon<'number'> {
  readonly defaultValue: number;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly step?: number;
}

/** One choice of a `choice` style. */
export interface ToolStyleChoiceOption {
  readonly value: string;
  readonly title: string;
}

/** One of the given choices, shown as a drop-down. */
export interface ToolStyleChoice extends ToolStyleCommon<'choice'> {
  readonly defaultValue: string;
  readonly options: readonly ToolStyleChoiceOption[];
}

/** Every kind of style a drawing may carry; `kind` says which one this is. */
export type ToolStyleDefinition = ToolStyleLine | ToolStyleColor | ToolStyleToggle | ToolStyleNumber | ToolStyleChoice;

/** The part of a style one stored key holds; a number or choice style is the key `id` itself. */
export type ToolStyleField = 'visible' | 'color' | 'width' | 'style';

/** The stored key of one part of a style: `${id}.${field}`. */
export function toolStyleKey(id: string, field: ToolStyleField): string {
  return `${id}.${field}`;
}

/** One stored key of a style, with the value it starts at and the rule that value must meet. */
interface ToolStyleSlot {
  readonly key: string;
  readonly defaultValue: ToolInputValue;
  readonly isValid: (value: unknown) => boolean;
}

const isBoolean = (value: unknown): boolean => typeof value === 'boolean';

function visibleSlot(id: string, defaultValue: boolean): ToolStyleSlot {
  return { key: toolStyleKey(id, 'visible'), defaultValue, isValid: isBoolean };
}

function colorSlot(id: string, defaultValue: string): ToolStyleSlot {
  return { key: toolStyleKey(id, 'color'), defaultValue, isValid: isColorText };
}

function lineSlots({ id, defaults }: ToolStyleLine): ToolStyleSlot[] {
  return [
    visibleSlot(id, defaults.visible),
    colorSlot(id, defaults.color),
    {
      key: toolStyleKey(id, 'width'),
      defaultValue: defaults.width,
      isValid: (value) => isFiniteInteger(value) && isNumberInBounds(LINE_WIDTH_BOUNDS, value),
    },
    { key: toolStyleKey(id, 'style'), defaultValue: defaults.style, isValid: (value) => LINE_STYLE_VALUES.has(value) },
  ];
}

function colorSlots({ id, defaults }: ToolStyleColor): ToolStyleSlot[] {
  const visible = defaults.visible === undefined ? [] : [visibleSlot(id, defaults.visible)];
  return [...visible, colorSlot(id, defaults.color)];
}

function toggleSlots({ id, defaults }: ToolStyleToggle): ToolStyleSlot[] {
  return [visibleSlot(id, defaults.visible)];
}

function numberSlots(definition: ToolStyleNumber): ToolStyleSlot[] {
  return [
    {
      key: definition.id,
      defaultValue: definition.defaultValue,
      isValid: (value) => isNumberInBounds(definition, value),
    },
  ];
}

function choiceSlots({ id, defaultValue, options }: ToolStyleChoice): ToolStyleSlot[] {
  return [{ key: id, defaultValue, isValid: (value) => options.some((option) => option.value === value) }];
}

/** The shape of one slot builder once the union of definitions is behind it. */
type ToolStyleSlotBuilder = (definition: ToolStyleDefinition) => ToolStyleSlot[];

/** One slot builder per kind, so adding a kind is one variant above and one entry here. */
const TOOL_STYLE_SLOTS = {
  line: lineSlots,
  color: colorSlots,
  toggle: toggleSlots,
  number: numberSlots,
  choice: choiceSlots,
} satisfies {
  readonly [Kind in ToolStyleDefinition['kind']]: (
    definition: Extract<ToolStyleDefinition, { kind: Kind }>,
  ) => ToolStyleSlot[];
};

function toolStyleSlots(definition: ToolStyleDefinition): ToolStyleSlot[] {
  // The table is keyed by kind, so its indexed type is the union of every entry.
  return (TOOL_STYLE_SLOTS[definition.kind] as ToolStyleSlotBuilder)(definition);
}

/** Every key one style stores, in the order the style declares them. */
export function toolStyleKeys(definition: ToolStyleDefinition): string[] {
  return toolStyleSlots(definition).map((slot) => slot.key);
}

/** Whether the stored values satisfy every key of this one style. */
export function isValidToolStyleValues(definition: ToolStyleDefinition, values: ToolInputValues): boolean {
  return toolStyleSlots(definition).every((slot) => slot.isValid(values[slot.key]));
}

/**
 * The flattened style values to work from: each key's stored value when it is valid, its default
 * otherwise. A stored key no style names is dropped, and `stored` that is not a record yields defaults.
 */
export function resolveToolStyleValues(definitions: readonly ToolStyleDefinition[], stored: unknown): ToolInputValues {
  const storedValues: Record<string, unknown> = isPlainRecord(stored) ? stored : {};
  return Object.fromEntries(
    definitions.flatMap(toolStyleSlots).map((slot): [string, ToolInputValue] => {
      const storedValue = storedValues[slot.key];
      return [slot.key, slot.isValid(storedValue) ? (storedValue as ToolInputValue) : slot.defaultValue];
    }),
  );
}

/** Every style's defaults, flattened to their stored keys: what nothing stored resolves to. */
export function defaultToolStyleValues(definitions: readonly ToolStyleDefinition[]): ToolInputValues {
  return resolveToolStyleValues(definitions, undefined);
}
