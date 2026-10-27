import { expect, test } from '@playwright/test';
import { profileResultFor } from './helpers/fakeMarketDataPort';
import { createRecordingCtx, createTestViewport, renderArgsFor, type PaintOp } from './helpers/overlayHarness';
import { drawFixedRangeProfile, type FixedRangeProfileState } from '../src/features/tools/fixedRangeProfile/overlay';
import type { ToolInputValues } from '../src/features/chart/engine/drawings/toolInputs';
import { readFixedRangeProfileSettings } from '../src/features/tools/fixedRangeProfile/settings';
import type { TickProfileBin } from '../src/shared/bridge/types';

/**
 * How the fixed range volume profile paints under its settings. Pure Node: a recording context captures every
 * rect and line, so the assertions run on what the pixels would show. The defaults must paint what the tool
 * painted before it had settings.
 */

const viewport = createTestViewport({ offset: 7, visibleRange: { from: 0, to: 9 }, scaleMode: 'regular' });
const { chartRect } = viewport;
// The harness maps bar i to x = 41 + 10 * i - 7 + 4: mid-bar 3 is x 73, bar 8 is x 118.
const START_X = 73;
const END_X = 118;
const RANGE = { fromMs: 1_000 + 3.5 * 60_000, toMs: 1_000 + 8 * 60_000 };
const UP_COLOR = '#26a69a';
const DOWN_COLOR = '#f7525f';
// The pane is 600 wide: 20% is 120 px, below the 180 px cap.
const FULL_LENGTH = 120;

const bin = (low: number, high: number, down: number, up: number): TickProfileBin => ({
  low: String(low),
  high: String(high),
  total: String(down + up),
  bid: String(down),
  ask: String(up),
});

// Down/up weights 6/40, 30/12 and 3/50: totals 46, 42, 53 and deltas +34, -18, +47.
const BINS = [bin(140, 150, 6, 40), bin(150, 160, 30, 12), bin(160, 170, 3, 50)];
const PROFILE = { ...profileResultFor({ fromMs: RANGE.fromMs, endMs: RANGE.toMs }, 'DEMO.TEST'), bins: BINS };
const LEVELS = { poc: '155.00', vah: '165.00', val: '145.00' };

interface Painted {
  ops: PaintOp[];
  hit: FixedRangeProfileState['hit'];
  rows: PaintOp[];
  lines: PaintOp[];
}

/** Paints the profile under the given stored settings; no settings paints with the defaults. */
function paint(stored?: ToolInputValues): Painted {
  const state: FixedRangeProfileState = { range: RANGE, profile: { ...PROFILE, ...LEVELS }, hit: {} };
  const ops: PaintOp[] = [];
  const ctx = createRecordingCtx((op) => ops.push(op), { recordClip: true });
  const { appearance } = readFixedRangeProfileSettings(stored);
  drawFixedRangeProfile(ctx, renderArgsFor(viewport).viewport, state, appearance);
  return {
    ops,
    hit: state.hit,
    rows: ops.filter((op) => op.kind === 'fillRect'),
    lines: ops.filter((op) => op.kind === 'stroke'),
  };
}

const widthOf = (op: PaintOp) => op.maxX - op.minX;
const withColor = (rows: PaintOp[], color: string) => rows.filter((row) => row.style === color);

test('no stored settings paint exactly what the defaults paint, and what the tool always painted', () => {
  const defaults = paint();
  expect(paint({}).ops).toEqual(defaults.ops);
  expect(defaults.rows).toHaveLength(6);
  // Down weight 30 is the longest down bar (30/50 of 120) and up weight 50 the longest up bar.
  expect(defaults.hit.anchorX).toBe(START_X);
  expect(defaults.hit.profileLeft).toBeCloseTo(START_X - 72, 9);
  expect(defaults.hit.profileRight).toBe(START_X + FULL_LENGTH);
  expect(withColor(defaults.rows, DOWN_COLOR).every((row) => row.maxX <= START_X)).toBe(true);
  expect(withColor(defaults.rows, UP_COLOR).every((row) => row.minX >= START_X)).toBe(true);
  expect(defaults.lines.map((line) => [line.style, line.dash])).toEqual([
    ['#ffd200', []],
    ['#f2f5fa', [4, 3]],
    ['#f2f5fa', [4, 3]],
  ]);
  for (const line of defaults.lines) {
    expect([line.minX, line.maxX]).toEqual([START_X, chartRect.x + chartRect.width]);
  }
});

test('total stacks the down part and then the up part of a row, scaled by the largest total', () => {
  const { rows, hit } = paint({ volume: 'Total' });
  expect(rows).toHaveLength(6);
  // The largest total is 53 (3 down + 50 up): its bar fills the full length from the anchor.
  const topDown = withColor(rows, DOWN_COLOR).find((row) => row.minY === viewport.priceToY(170));
  const topUp = withColor(rows, UP_COLOR).find((row) => row.minY === viewport.priceToY(170));
  expect(topDown?.minX).toBe(START_X);
  expect(widthOf(topDown as PaintOp)).toBeCloseTo((FULL_LENGTH * 3) / 53, 9);
  expect(topUp?.minX).toBeCloseTo((topDown as PaintOp).maxX, 9);
  expect(topUp?.maxX).toBeCloseTo(START_X + FULL_LENGTH, 9);
  expect(hit.profileLeft).toBe(START_X);
  expect(hit.profileRight).toBeCloseTo(START_X + FULL_LENGTH, 9);
});

test('delta draws one bar per row of the difference, in the colour of the side that leads', () => {
  const { rows, hit } = paint({ volume: 'Delta' });
  expect(rows).toHaveLength(3);
  const byRow = (high: number) => rows.find((row) => row.minY === viewport.priceToY(high)) as PaintOp;
  // The largest difference is 47, so +34 and -18 take 34/47 and 18/47 of the full length.
  expect(byRow(150).style).toBe(UP_COLOR);
  expect(widthOf(byRow(150))).toBeCloseTo((FULL_LENGTH * 34) / 47, 9);
  expect(byRow(160).style).toBe(DOWN_COLOR);
  expect(widthOf(byRow(160))).toBeCloseTo((FULL_LENGTH * 18) / 47, 9);
  expect(widthOf(byRow(170))).toBeCloseTo(FULL_LENGTH, 9);
  expect(rows.every((row) => row.minX === START_X)).toBe(true);
  expect(hit.profileRight).toBeCloseTo(START_X + FULL_LENGTH, 9);
});

test('a row with equal down and up volume has no delta bar', () => {
  const state: FixedRangeProfileState = {
    range: RANGE,
    profile: { ...PROFILE, ...LEVELS, bins: [bin(140, 150, 9, 9), bin(150, 160, 2, 8)] },
    hit: {},
  };
  const ops: PaintOp[] = [];
  const { appearance } = readFixedRangeProfileSettings({ volume: 'Delta' });
  drawFixedRangeProfile(
    createRecordingCtx((op) => ops.push(op)),
    renderArgsFor(viewport).viewport,
    state,
    appearance,
  );
  expect(ops.filter((op) => op.kind === 'fillRect')).toHaveLength(1);
});

test('placement right hangs the bars from the range end: mirrored for up/down, growing left otherwise', () => {
  const mirrored = paint({ placement: 'Right' });
  expect(mirrored.hit.anchorX).toBe(END_X);
  expect(mirrored.hit.profileLeft).toBeCloseTo(END_X - 72, 9);
  expect(mirrored.hit.profileRight).toBe(END_X + FULL_LENGTH);

  for (const volume of ['Total', 'Delta']) {
    const { hit, rows } = paint({ placement: 'Right', volume });
    expect(hit.anchorX).toBe(END_X);
    expect(hit.profileRight).toBe(END_X);
    expect(hit.profileLeft).toBeCloseTo(END_X - FULL_LENGTH, 9);
    expect(rows.every((row) => row.maxX <= END_X + 1e-9)).toBe(true);
  }
});

test('the width setting sets the bar length and the 180 px cap still holds', () => {
  expect(paint({ widthPercent: 10 }).hit.profileRight).toBe(START_X + 60);
  expect(paint({ widthPercent: 50 }).hit.profileRight).toBe(START_X + 180);
});

test('the up and down colours restyle the bars', () => {
  const { rows } = paint({ 'upVolume.color': '#112233', 'downVolume.color': '#445566' });
  expect(new Set(rows.map((row) => row.style))).toEqual(new Set(['#112233', '#445566']));
});

test('a hidden level paints no line and reports no y', () => {
  const visible = paint();
  expect(visible.hit.pocY).toBeCloseTo(viewport.priceToY(155), 9);

  const withoutPoc = paint({ 'poc.visible': false });
  expect(withoutPoc.lines).toHaveLength(2);
  expect(withoutPoc.hit.pocY).toBeUndefined();
  expect(withoutPoc.hit.vahY).toBeDefined();

  const withoutAny = paint({ 'poc.visible': false, 'vah.visible': false, 'val.visible': false });
  expect(withoutAny.lines).toHaveLength(0);
  expect([withoutAny.hit.pocY, withoutAny.hit.vahY, withoutAny.hit.valY]).toEqual([undefined, undefined, undefined]);
});

test('a level takes its own colour and dash', () => {
  const { lines } = paint({ 'poc.color': '#112233', 'poc.style': 'dotted', 'vah.style': 'solid' });
  expect(lines.map((line) => [line.style, line.dash])).toEqual([
    ['#112233', [1, 3]],
    ['#f2f5fa', []],
    ['#f2f5fa', [4, 3]],
  ]);
});

test('without extend right the level lines stop at the range end', () => {
  for (const placement of ['Left', 'Right']) {
    const { lines } = paint({ extendRight: false, placement });
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect([line.minX, line.maxX]).toEqual([START_X, END_X]);
    }
  }
});

test('the paint stays clipped to the pane under every setting', () => {
  const { ops } = paint({ volume: 'Total', placement: 'Right', widthPercent: 50 });
  expect(ops[0]).toMatchObject({
    kind: 'clip',
    minX: chartRect.x,
    maxX: chartRect.x + chartRect.width,
    minY: chartRect.y,
    maxY: chartRect.y + chartRect.height,
  });
});
