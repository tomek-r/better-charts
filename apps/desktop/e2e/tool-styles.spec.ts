import { expect, test } from '@playwright/test';
import { isToolInputActive, type ToolInputDefinition } from '../src/features/chart/engine/drawings/toolInputs';
import {
  assertUniqueToolSettingKeys,
  resolveToolSettingValues,
} from '../src/features/chart/engine/drawings/toolSettings';
import {
  defaultToolStyleValues,
  isValidToolStyleValues,
  resolveToolStyleValues,
} from '../src/features/chart/engine/drawings/toolStyles';
import {
  ALL_STYLES,
  COLLIDING_INPUT,
  PLACEMENT,
  POC_LINE,
  PROFILE_TOGGLE,
  VALUE_AREA_UP,
  WIDTH_PERCENT,
} from './helpers/toolStyleFixtures';

/**
 * The Style tab's schema: each style flattens to scalar keys beside the inputs, resolves with the same
 * rules as inputs, and a key clash is refused when the tool's drawings are defined. Pure Node, no browser.
 */

const DEFAULT_STYLE_VALUES = {
  'profile.visible': true,
  'histogramBox.color': '#2962ff33',
  'poc.visible': true,
  'poc.color': '#ff0000',
  'poc.width': 2,
  'poc.style': 'solid',
  'valueAreaUp.visible': true,
  'valueAreaUp.color': '#00ff00',
  widthPercent: 70,
  placement: 'left',
};

test('every style kind flattens to its scalar keys', () => {
  expect(defaultToolStyleValues(ALL_STYLES)).toEqual(DEFAULT_STYLE_VALUES);
});

test('a colour style without a visible default stores no visible key', () => {
  expect(Object.keys(defaultToolStyleValues([ALL_STYLES[1]]))).toEqual(['histogramBox.color']);
});

test('stored style values that are valid win over the defaults', () => {
  const stored = {
    'poc.color': '#0000ff80',
    'poc.width': 4,
    'poc.style': 'dotted',
    widthPercent: 55,
    placement: 'right',
  };
  expect(resolveToolStyleValues(ALL_STYLES, stored)).toEqual({ ...DEFAULT_STYLE_VALUES, ...stored });
});

test('stored settings that are not a record yield every default', () => {
  expect(resolveToolStyleValues(ALL_STYLES, ['poc.width'])).toEqual(DEFAULT_STYLE_VALUES);
  expect(resolveToolStyleValues(ALL_STYLES, undefined)).toEqual(DEFAULT_STYLE_VALUES);
});

test('stored keys no style names are dropped', () => {
  expect(resolveToolStyleValues([PROFILE_TOGGLE], { 'profile.visible': false, vanished: 5 })).toEqual({
    'profile.visible': false,
  });
});

const INVALID_STYLE_VALUES: ReadonlyArray<{ name: string; key: string; value: unknown }> = [
  { name: 'a colour that is not a hex code', key: 'poc.color', value: 'red' },
  { name: 'a colour with a short hex code', key: 'valueAreaUp.color', value: '#12345' },
  { name: 'a width above the maximum', key: 'poc.width', value: 5 },
  { name: 'a width below the minimum', key: 'poc.width', value: 0 },
  { name: 'a width that is not whole', key: 'poc.width', value: 1.5 },
  { name: 'a dash pattern outside the three', key: 'poc.style', value: 'wavy' },
  { name: 'a visible flag that is not a boolean', key: 'profile.visible', value: 1 },
  { name: 'a number above its maximum', key: 'widthPercent', value: 500 },
  { name: 'a choice outside its options', key: 'placement', value: 'middle' },
];

for (const { name, key, value } of INVALID_STYLE_VALUES) {
  test(`${name} falls back to the default`, () => {
    const resolved = resolveToolStyleValues(ALL_STYLES, { [key]: value });
    expect(resolved[key]).toBe(DEFAULT_STYLE_VALUES[key as keyof typeof DEFAULT_STYLE_VALUES]);
  });
}

test('a style is valid only while every key it stores is valid', () => {
  expect(isValidToolStyleValues(POC_LINE, DEFAULT_STYLE_VALUES)).toBe(true);
  expect(isValidToolStyleValues(POC_LINE, { ...DEFAULT_STYLE_VALUES, 'poc.width': 9 })).toBe(false);
  expect(isValidToolStyleValues(VALUE_AREA_UP, { ...DEFAULT_STYLE_VALUES, 'valueAreaUp.color': '' })).toBe(false);
  expect(isValidToolStyleValues(WIDTH_PERCENT, { ...DEFAULT_STYLE_VALUES, widthPercent: '' })).toBe(false);
  expect(isValidToolStyleValues(PLACEMENT, DEFAULT_STYLE_VALUES)).toBe(true);
});

test('inputs and styles resolve into one map and unknown keys are dropped', () => {
  const settings = {
    inputs: [{ kind: 'int', id: 'bars', title: 'Bars', defaultValue: 20 }] satisfies ToolInputDefinition[],
    styles: [PROFILE_TOGGLE],
  };
  expect(resolveToolSettingValues(settings, { bars: 30, 'profile.visible': false, vanished: 1 })).toEqual({
    bars: 30,
    'profile.visible': false,
  });
});

test('a style id that repeats an input id is refused when the tool is defined', () => {
  expect(() => assertUniqueToolSettingKeys({ inputs: [COLLIDING_INPUT], styles: ALL_STYLES })).toThrow(
    'Drawing setting key "poc.color" is declared twice.',
  );
});

test('two styles with one id are refused when the tool is defined', () => {
  expect(() => assertUniqueToolSettingKeys({ styles: [PLACEMENT, PLACEMENT] })).toThrow('"placement"');
});

test('distinct input and style ids are accepted', () => {
  expect(() => assertUniqueToolSettingKeys({ inputs: [], styles: ALL_STYLES })).not.toThrow();
});

test('an input is active without a condition and follows the other input when it has one', () => {
  const dependent = {
    kind: 'int',
    id: 'bars',
    title: 'Bars',
    defaultValue: 20,
    activeWhen: { inputId: 'useRange', equals: true },
  } satisfies ToolInputDefinition;
  expect(isToolInputActive({ ...dependent, activeWhen: undefined }, {})).toBe(true);
  expect(isToolInputActive(dependent, { useRange: false })).toBe(false);
  expect(isToolInputActive(dependent, { useRange: true })).toBe(true);
});
