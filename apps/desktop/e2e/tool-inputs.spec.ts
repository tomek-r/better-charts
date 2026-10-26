import { expect, test } from '@playwright/test';
import { readChartDrawingRecord } from '../src/features/chart/engine/drawings/drawingRecord';
import {
  defaultToolInputValues,
  isValidToolInputValue,
  resolveToolInputValues,
  type ToolInputDefinition,
} from '../src/features/chart/engine/drawings/toolInputs';
import { timeframeOptions } from '../src/shared/bridge/timeframes';

/**
 * The settings schema one drawing carries: one definition per Pine Script v6 input kind,
 * one validator table behind them, and the stored record around them. Pure Node, no browser.
 */

const INT_INPUT = {
  kind: 'int',
  id: 'period',
  title: 'Period',
  defaultValue: 20,
  minValue: 1,
  maxValue: 200,
  step: 1,
} satisfies ToolInputDefinition;

const FLOAT_INPUT = {
  kind: 'float',
  id: 'ratio',
  title: 'Ratio',
  defaultValue: 1.5,
  minValue: 0,
  maxValue: 4,
  step: 0.5,
} satisfies ToolInputDefinition;

const BOOL_INPUT = { kind: 'bool', id: 'filled', title: 'Filled', defaultValue: true } satisfies ToolInputDefinition;

const STRING_INPUT = {
  kind: 'string',
  id: 'profile',
  title: 'Profile',
  defaultValue: 'volume',
  options: ['volume', 'trades'],
} satisfies ToolInputDefinition;

const TEXT_AREA_INPUT = {
  kind: 'textArea',
  id: 'note',
  title: 'Note',
  defaultValue: 'opening range',
} satisfies ToolInputDefinition;

const COLOR_INPUT = {
  kind: 'color',
  id: 'tint',
  title: 'Tint',
  defaultValue: '#3366ff',
} satisfies ToolInputDefinition;

const SOURCE_INPUT = {
  kind: 'source',
  id: 'basis',
  title: 'Basis',
  defaultValue: 'hlc3',
} satisfies ToolInputDefinition;

const TIMEFRAME_INPUT = {
  kind: 'timeframe',
  id: 'window',
  title: 'Window',
  defaultValue: timeframeOptions[0].wire,
} satisfies ToolInputDefinition;

const SYMBOL_INPUT = {
  kind: 'symbol',
  id: 'symbol',
  title: 'Symbol',
  defaultValue: 'EURUSD',
} satisfies ToolInputDefinition;

const SESSION_INPUT = {
  kind: 'session',
  id: 'session',
  title: 'Session',
  defaultValue: '0930-1600:23456',
} satisfies ToolInputDefinition;

const PRICE_INPUT = {
  kind: 'price',
  id: 'level',
  title: 'Level',
  defaultValue: 1.2345,
} satisfies ToolInputDefinition;

const TIME_INPUT = {
  kind: 'time',
  id: 'since',
  title: 'Since',
  defaultValue: Date.now(),
} satisfies ToolInputDefinition;

const ENUM_INPUT = {
  kind: 'enum',
  id: 'method',
  title: 'Method',
  defaultValue: 'stepped',
  options: [
    { value: 'stepped', title: 'Stepped' },
    { value: 'smooth', title: 'Smooth' },
  ],
} satisfies ToolInputDefinition;

const ALL_INPUTS: readonly ToolInputDefinition[] = [
  INT_INPUT,
  FLOAT_INPUT,
  BOOL_INPUT,
  STRING_INPUT,
  TEXT_AREA_INPUT,
  COLOR_INPUT,
  SOURCE_INPUT,
  TIMEFRAME_INPUT,
  SYMBOL_INPUT,
  SESSION_INPUT,
  PRICE_INPUT,
  TIME_INPUT,
  ENUM_INPUT,
];

test('every kind accepts its own default value', () => {
  for (const definition of ALL_INPUTS) {
    expect(isValidToolInputValue(definition, definition.defaultValue)).toBe(true);
  }
});

test('the defaults of every definition are keyed by input id', () => {
  expect(defaultToolInputValues(ALL_INPUTS)).toEqual({
    period: 20,
    ratio: 1.5,
    filled: true,
    profile: 'volume',
    note: 'opening range',
    tint: '#3366ff',
    basis: 'hlc3',
    window: timeframeOptions[0].wire,
    symbol: 'EURUSD',
    session: '0930-1600:23456',
    level: 1.2345,
    since: TIME_INPUT.defaultValue,
    method: 'stepped',
  });
});

test('no stored settings at all yields every default', () => {
  const resolved = resolveToolInputValues(ALL_INPUTS, undefined);
  expect(resolved).toEqual(defaultToolInputValues(ALL_INPUTS));
  expect(resolved.period).toBe(20);
  expect(resolved.method).toBe('stepped');
});

test('stored settings that are not a record yield every default', () => {
  const expected = { period: 20, method: 'stepped' };
  expect(resolveToolInputValues([INT_INPUT, ENUM_INPUT], ['period'])).toEqual(expected);
  expect(resolveToolInputValues([INT_INPUT, ENUM_INPUT], 'period=20')).toEqual(expected);
});

test('a valid stored value wins over the default', () => {
  expect(resolveToolInputValues([INT_INPUT, COLOR_INPUT], { period: 55, tint: '#ff000080' })).toEqual({
    period: 55,
    tint: '#ff000080',
  });
});

test('stored keys without a definition are dropped', () => {
  expect(resolveToolInputValues([INT_INPUT], { period: 30, vanished: 5 })).toEqual({ period: 30 });
});

interface InvalidInput {
  readonly name: string;
  readonly definition: ToolInputDefinition;
  readonly value: unknown;
}

const INVALID_INPUTS: readonly InvalidInput[] = [
  { name: 'an int of the wrong type', definition: INT_INPUT, value: '20' },
  { name: 'an int below its minimum', definition: INT_INPUT, value: 0 },
  { name: 'an int that is not whole', definition: INT_INPUT, value: 2.5 },
  { name: 'a float above its maximum', definition: FLOAT_INPUT, value: 9 },
  { name: 'a bool of the wrong type', definition: BOOL_INPUT, value: 1 },
  { name: 'a string outside its options', definition: STRING_INPUT, value: 'purple' },
  { name: 'a text area of the wrong type', definition: TEXT_AREA_INPUT, value: 7 },
  { name: 'a colour with a short hex code', definition: COLOR_INPUT, value: '#12345' },
  { name: 'an unknown source', definition: SOURCE_INPUT, value: 'volume' },
  { name: 'an unknown timeframe', definition: TIMEFRAME_INPUT, value: 'H7' },
  { name: 'a blank symbol', definition: SYMBOL_INPUT, value: '   ' },
  { name: 'a session without four-digit hours', definition: SESSION_INPUT, value: '9:30-16:00' },
  { name: 'a price that is not finite', definition: PRICE_INPUT, value: Number.NaN },
  { name: 'a time that is not an integer', definition: TIME_INPUT, value: 1.5 },
  { name: 'an enum value outside its options', definition: ENUM_INPUT, value: 'jumped' },
];

for (const { name, definition, value } of INVALID_INPUTS) {
  test(`${definition.kind} rejects ${name} and falls back to the default`, () => {
    expect(isValidToolInputValue(definition, value)).toBe(false);
    expect(resolveToolInputValues([definition], { [definition.id]: value })).toEqual({
      [definition.id]: definition.defaultValue,
    });
  });
}

const STORED_DRAWING = {
  id: 'drawing-1',
  toolId: 'fixedRangeProfile',
  locked: false,
  inputs: { period: 20, filled: true, basis: 'hlc3' },
  geometry: { from: { index: 4 }, to: { index: 9 } },
};

function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}

test('a well-formed stored drawing is read back unchanged', () => {
  expect(readChartDrawingRecord(STORED_DRAWING)).toEqual(STORED_DRAWING);
});

const REJECTED_DRAWINGS: ReadonlyArray<{ name: string; value: unknown }> = [
  { name: 'a drawing without geometry', value: withoutKey(STORED_DRAWING, 'geometry') },
  { name: 'a drawing with an empty id', value: { ...STORED_DRAWING, id: '' } },
  { name: 'a drawing with an empty tool id', value: { ...STORED_DRAWING, toolId: '' } },
  { name: 'a drawing whose lock flag is not a boolean', value: { ...STORED_DRAWING, locked: 'no' } },
  { name: 'a drawing with an object as an input value', value: { ...STORED_DRAWING, inputs: { period: {} } } },
  { name: 'a drawing that is not a record at all', value: 'drawing-1' },
];

for (const { name, value } of REJECTED_DRAWINGS) {
  test(`reading ${name} yields undefined`, () => {
    expect(readChartDrawingRecord(value)).toBeUndefined();
  });
}
