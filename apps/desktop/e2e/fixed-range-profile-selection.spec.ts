import { test, expect } from '@playwright/test';
import { createFakeMarketDataPort } from './helpers/fakeMarketDataPort';
import { createFakeToolHost } from './helpers/fakeToolHost';
import { FixedRangeProfileDrawing } from '../src/features/tools/fixedRangeProfile/drawing/fixedRangeProfileDrawing';
import type { FixedRangeProfileState } from '../src/features/tools/fixedRangeProfile/profileState';
import { TickProfileRequestQueue } from '../src/features/tools/fixedRangeProfile/requests/tickProfileRequestQueue';

/**
 * What a press selects: the handles, the band between them, and whatever the last paint reported outside the
 * band, the histogram bars, the values column, the histogram box and the level lines. The fake host's handles sit
 * at x 20 and 60 (slots 2 and 6).
 */

const WINDOW = { fromMs: 1_140_000, endMs: 1_440_000 };
const LAST_SLOT_OPEN_MS = 1_380_000;
const BAND_X = 40;
/** Left of the start handle by more than the handle's reach, so only a painted extent can contain it. */
const OUTSIDE_X = 10;
/** Right of the end handle by more than its reach, where only Extend Right paints. */
const EXTENDED_X = 100;
const INSIDE_Y = 150;
const BELOW_Y = 250;

function drawingThatPainted(hit: FixedRangeProfileState['hit']): FixedRangeProfileDrawing {
  const market = createFakeMarketDataPort();
  const { host } = createFakeToolHost(market.port);
  const drawing = FixedRangeProfileDrawing.restored(
    host,
    new TickProfileRequestQueue(market.port),
    WINDOW,
    LAST_SLOT_OPEN_MS,
  );
  drawing.state.hit = hit;
  return drawing;
}

test('the band between the handles is contained, a point left of it is not', () => {
  const drawing = drawingThatPainted({});
  expect(drawing.contains(BAND_X, INSIDE_Y)).toBe(true);
  expect(drawing.contains(OUTSIDE_X, INSIDE_Y)).toBe(false);
});

test('a down bar painted left of the start line is contained, above and below its rows it is not', () => {
  const drawing = drawingThatPainted({ profileLeft: 5, profileRight: 35, profileTop: 100, profileBottom: 200 });
  expect(drawing.contains(OUTSIDE_X, INSIDE_Y)).toBe(true);
  expect(drawing.contains(OUTSIDE_X, BELOW_Y)).toBe(false);
});

test('with no profile painted (previewing or no bins) the same point is not contained', () => {
  expect(drawingThatPainted({}).contains(OUTSIDE_X, INSIDE_Y)).toBe(false);
});

test('a label of the values column left of the start line is contained, and no column contains nothing', () => {
  const column = { valuesColumnLeft: 2, valuesColumnRight: 18, valuesColumnTop: 120, valuesColumnBottom: 180 };
  expect(drawingThatPainted(column).contains(OUTSIDE_X, INSIDE_Y)).toBe(true);
  expect(drawingThatPainted(column).contains(OUTSIDE_X, BELOW_Y)).toBe(false);
  expect(drawingThatPainted({}).contains(OUTSIDE_X, INSIDE_Y)).toBe(false);
});

test('a column half outside the band, centred on the start line, is contained on its outside half', () => {
  const column = { valuesColumnLeft: 4, valuesColumnRight: 36, valuesColumnTop: 120, valuesColumnBottom: 180 };
  expect(drawingThatPainted(column).contains(OUTSIDE_X, INSIDE_Y)).toBe(true);
});

test('a press on the painted histogram box past the range end selects the profile', () => {
  const box = { boxLeft: 20, boxRight: 120, boxTop: 100, boxBottom: 200 };
  expect(drawingThatPainted(box).contains(EXTENDED_X, INSIDE_Y)).toBe(true);
  expect(drawingThatPainted(box).contains(EXTENDED_X, BELOW_Y)).toBe(false);
  expect(drawingThatPainted({}).contains(EXTENDED_X, INSIDE_Y)).toBe(false);
});

test('a press on a level line past the range end selects the profile, beside it does not', () => {
  const line = { pocY: INSIDE_Y, levelLeft: 20, levelRight: 120 };
  expect(drawingThatPainted(line).contains(EXTENDED_X, INSIDE_Y + 3)).toBe(true);
  expect(drawingThatPainted(line).contains(EXTENDED_X, INSIDE_Y + 10)).toBe(false);
  // Past the line's right end at 120, and right of the band's reach too.
  expect(drawingThatPainted(line).contains(130, INSIDE_Y)).toBe(false);
});
