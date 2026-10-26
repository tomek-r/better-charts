import { test, expect } from '@playwright/test';
import {
  fixedRangeProfileGeometry,
  readFixedRangeProfileGeometry,
} from '../src/features/tools/fixedRangeProfile/drawing/fixedRangeProfileGeometry';

/**
 * The geometry one FRVP drawing stores. The engine treats it as opaque JSON, so the only way back in
 * is this reader: it accepts exactly the windows the tool can paint and rejects everything else.
 */

const NOW_MS = Date.now();
const ONE_MINUTE_MS = 60_000;

/** A closed one-minute window whose last slot opens a minute before its exclusive end. */
const GEOMETRY = { fromMs: NOW_MS - ONE_MINUTE_MS, endMs: NOW_MS, lastSlotOpenMs: NOW_MS - ONE_MINUTE_MS };

test('a stored geometry reads back and a range is copied without a reference to it', () => {
  expect(readFixedRangeProfileGeometry(GEOMETRY)).toEqual(GEOMETRY);
  const copied = fixedRangeProfileGeometry(GEOMETRY);
  expect(copied).toEqual(GEOMETRY);
  expect(copied).not.toBe(GEOMETRY);
});

/** A stored value with one field replaced, so a rejection names the single broken rule. */
function withField(field: keyof typeof GEOMETRY, value: unknown): Record<string, unknown> {
  return { ...GEOMETRY, [field]: value };
}

function withoutField(field: keyof typeof GEOMETRY): Record<string, unknown> {
  return Object.fromEntries(Object.entries(GEOMETRY).filter(([key]) => key !== field));
}

const REJECTED: ReadonlyArray<{ name: string; value: unknown }> = [
  { name: 'a value that is not a record', value: `${NOW_MS}` },
  { name: 'a fromMs that is not an integer', value: withField('fromMs', NOW_MS - 1.5) },
  { name: 'an endMs of NaN', value: withField('endMs', Number.NaN) },
  { name: 'a lastSlotOpenMs that is infinite', value: withField('lastSlotOpenMs', Number.POSITIVE_INFINITY) },
  { name: 'a window without fromMs', value: withoutField('fromMs') },
  { name: 'a window without endMs', value: withoutField('endMs') },
  { name: 'a window without lastSlotOpenMs', value: withoutField('lastSlotOpenMs') },
  { name: 'a start after the last slot', value: withField('fromMs', NOW_MS - ONE_MINUTE_MS + 1) },
  { name: 'a last slot at or past the end', value: withField('lastSlotOpenMs', NOW_MS) },
];

for (const { name, value } of REJECTED) {
  test(`${name} is rejected`, () => {
    expect(readFixedRangeProfileGeometry(value)).toBeUndefined();
  });
}
