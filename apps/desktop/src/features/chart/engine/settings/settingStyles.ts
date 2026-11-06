import {
  isColorText,
  isFiniteInteger,
  isNumberInBounds,
  isPlainRecord,
  type SettingValue,
  type SettingValues,
} from './settingInputs';

// The Style tab of one drawing: how its lines, levels and fills are drawn. Styles are declared apart from
// inputs, but a style is stored as scalar values in
// the same map as the inputs: the store accepts only numbers, booleans and strings, so each style
// flattens to the keys `settingStyleKey` names.

/** The line widths a `line` style offers, in CSS px. */
export const SETTING_STYLE_LINE_WIDTHS = [1, 2, 3, 4] as const;

/** The dash patterns a `line` style offers. */
export const SETTING_STYLE_LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;

export type SettingStyleLineStyle = (typeof SETTING_STYLE_LINE_STYLES)[number];

const LINE_WIDTH_BOUNDS = {
  minValue: SETTING_STYLE_LINE_WIDTHS[0],
  maxValue: SETTING_STYLE_LINE_WIDTHS[SETTING_STYLE_LINE_WIDTHS.length - 1],
};
const LINE_STYLE_VALUES: ReadonlySet<unknown> = new Set(SETTING_STYLE_LINE_STYLES);

/** Fields every style carries. A child renders under its parent and follows the parent's checkbox. */
interface SettingStyleCommon<Kind extends string> {
  readonly kind: Kind;
  readonly id: string;
  readonly title: string;
  readonly parentId?: string;
  /** The caption of the group this style opens in the Style tab; the styles after it belong to that group. */
  readonly section?: string;
}

/** A line: a checkbox, a colour, and a width and dash pattern. */
export interface SettingStyleLine extends SettingStyleCommon<'line'> {
  readonly defaults: {
    readonly visible: boolean;
    readonly color: string;
    readonly width: number;
    readonly style: SettingStyleLineStyle;
  };
}

/** A colour row; it has a checkbox only when its defaults say `visible`. */
export interface SettingStyleColor extends SettingStyleCommon<'color'> {
  readonly defaults: { readonly visible?: boolean; readonly color: string };
}

/** A checkbox-only row, usually the parent of the styles it shows or hides. */
export interface SettingStyleToggle extends SettingStyleCommon<'toggle'> {
  readonly defaults: { readonly visible: boolean };
}

/** A number, bounded and stepped like an `int` input. */
export interface SettingStyleNumber extends SettingStyleCommon<'number'> {
  readonly defaultValue: number;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly step?: number;
}

/** One choice of a style that offers a list of them. */
export interface SettingStyleChoiceOption {
  readonly value: string;
  readonly title: string;
}

/** The list a style offers: the one it starts with, and every one it accepts. */
interface SettingStyleChoiceList {
  readonly defaultValue: string;
  readonly options: readonly SettingStyleChoiceOption[];
}

/** One of the given choices, shown as a drop-down. */
export interface SettingStyleChoice extends SettingStyleCommon<'choice'>, SettingStyleChoiceList {}

/**
 * One way a plot is drawn, plus whether it draws a line at its last value. The chosen type is stored under
 * `id`; the switch is the `visible` key of the `priceLineId` style, which this style owns.
 */
export interface SettingStylePlotType extends SettingStyleCommon<'plotType'>, SettingStyleChoiceList {
  readonly priceLineId: string;
  /**
   * The style whose row draws this button after its own controls, in place of a row of its own. A style the
   * drawing does not declare leaves the button on a row of its own, so it is never lost.
   */
  readonly inlineWithId?: string;
}

/** Every kind of style a drawing may carry; `kind` says which one this is. */
export type SettingStyleDefinition =
  | SettingStyleLine
  | SettingStyleColor
  | SettingStyleToggle
  | SettingStyleNumber
  | SettingStyleChoice
  | SettingStylePlotType;

/** The part of a style one stored key holds; a number or choice style is the key `id` itself. */
export type SettingStyleField = 'visible' | 'color' | 'width' | 'style';

/** The stored key of one part of a style: `${id}.${field}`. */
export function settingStyleKey(id: string, field: SettingStyleField): string {
  return `${id}.${field}`;
}

/** One stored key of a style, with the value it starts at and the rule that value must meet. */
interface SettingStyleSlot {
  readonly key: string;
  readonly defaultValue: SettingValue;
  readonly isValid: (value: unknown) => boolean;
}

const isBoolean = (value: unknown): boolean => typeof value === 'boolean';

function visibleSlot(id: string, defaultValue: boolean): SettingStyleSlot {
  return { key: settingStyleKey(id, 'visible'), defaultValue, isValid: isBoolean };
}

function colorSlot(id: string, defaultValue: string): SettingStyleSlot {
  return { key: settingStyleKey(id, 'color'), defaultValue, isValid: isColorText };
}

function lineSlots({ id, defaults }: SettingStyleLine): SettingStyleSlot[] {
  return [
    visibleSlot(id, defaults.visible),
    colorSlot(id, defaults.color),
    {
      key: settingStyleKey(id, 'width'),
      defaultValue: defaults.width,
      isValid: (value) => isFiniteInteger(value) && isNumberInBounds(LINE_WIDTH_BOUNDS, value),
    },
    {
      key: settingStyleKey(id, 'style'),
      defaultValue: defaults.style,
      isValid: (value) => LINE_STYLE_VALUES.has(value),
    },
  ];
}

function colorSlots({ id, defaults }: SettingStyleColor): SettingStyleSlot[] {
  const visible = defaults.visible === undefined ? [] : [visibleSlot(id, defaults.visible)];
  return [...visible, colorSlot(id, defaults.color)];
}

function toggleSlots({ id, defaults }: SettingStyleToggle): SettingStyleSlot[] {
  return [visibleSlot(id, defaults.visible)];
}

function numberSlots(definition: SettingStyleNumber): SettingStyleSlot[] {
  return [
    {
      key: definition.id,
      defaultValue: definition.defaultValue,
      isValid: (value) => isNumberInBounds(definition, value),
    },
  ];
}

function choiceSlots({ id, defaultValue, options }: SettingStyleChoice | SettingStylePlotType): SettingStyleSlot[] {
  return [{ key: id, defaultValue, isValid: (value) => options.some((option) => option.value === value) }];
}

/** A plot type and its price line switch: the chosen type, then whether a line is drawn at its last value. */
function plotTypeSlots(definition: SettingStylePlotType): SettingStyleSlot[] {
  return [...choiceSlots(definition), visibleSlot(definition.priceLineId, false)];
}

/** The shape of one slot builder once the union of definitions is behind it. */
type SettingStyleSlotBuilder = (definition: SettingStyleDefinition) => SettingStyleSlot[];

/** One slot builder per kind, so adding a kind is one variant above and one entry here. */
const SETTING_STYLE_SLOTS = {
  line: lineSlots,
  color: colorSlots,
  toggle: toggleSlots,
  number: numberSlots,
  choice: choiceSlots,
  plotType: plotTypeSlots,
} satisfies {
  readonly [Kind in SettingStyleDefinition['kind']]: (
    definition: Extract<SettingStyleDefinition, { kind: Kind }>,
  ) => SettingStyleSlot[];
};

function settingStyleSlots(definition: SettingStyleDefinition): SettingStyleSlot[] {
  // The table is keyed by kind, so its indexed type is the union of every entry.
  return (SETTING_STYLE_SLOTS[definition.kind] as SettingStyleSlotBuilder)(definition);
}

/** Every key one style stores, in the order the style declares them. */
export function settingStyleKeys(definition: SettingStyleDefinition): string[] {
  return settingStyleSlots(definition).map((slot) => slot.key);
}

/** Whether the stored values satisfy every key of this one style. */
export function isValidSettingStyleValues(definition: SettingStyleDefinition, values: SettingValues): boolean {
  return settingStyleSlots(definition).every((slot) => slot.isValid(values[slot.key]));
}

/**
 * The flattened style values to work from: each key's stored value when it is valid, its default
 * otherwise. A stored key no style names is dropped, and `stored` that is not a record yields defaults.
 */
export function resolveSettingStyleValues(
  definitions: readonly SettingStyleDefinition[],
  stored: unknown,
): SettingValues {
  const storedValues: Record<string, unknown> = isPlainRecord(stored) ? stored : {};
  return Object.fromEntries(
    definitions.flatMap(settingStyleSlots).map((slot): [string, SettingValue] => {
      const storedValue = storedValues[slot.key];
      return [slot.key, slot.isValid(storedValue) ? (storedValue as SettingValue) : slot.defaultValue];
    }),
  );
}

/** Every style's defaults, flattened to their stored keys: what nothing stored resolves to. */
export function defaultSettingStyleValues(definitions: readonly SettingStyleDefinition[]): SettingValues {
  return resolveSettingStyleValues(definitions, undefined);
}
