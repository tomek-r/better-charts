import { expect, test } from '@playwright/test';
import { profileResultFor } from './helpers/fakeMarketDataPort';
import { createRecordingCtx, createTestViewport, renderArgsFor, type PaintOp } from './helpers/overlayHarness';
import { drawFixedRangeProfile, type FixedRangeProfileState } from '../src/features/tools/fixedRangeProfile/overlay';
import type { ToolInputValues } from '../src/features/chart/engine/drawings/toolInputs';
import { readFixedRangeProfileSettings } from '../src/features/tools/fixedRangeProfile/settings';
import type { TickProfileBin } from '../src/shared/bridge/types';
import { palette } from '../src/shared/theme/palette';

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
// The width setting is a share of the range, handle to handle: 45 px here, so the default 20% is 9 px.
const RANGE_WIDTH = END_X - START_X;
const FULL_LENGTH = RANGE_WIDTH * 0.2;
// Up/Down mirrors around an axis half that extent inside the range, from its start (Left) or its end (Right).
const LEFT_AXIS_X = START_X + FULL_LENGTH / 2;
const RIGHT_AXIS_X = END_X - FULL_LENGTH / 2;

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
  // The mirrored bars share the extent: each side's longest is at most half of it, so the up weight 50 (the
  // common maximum) takes half the extent and the down weight 30 takes 30/50 of that, around the axis.
  expect(defaults.hit.anchorX).toBe(START_X);
  expect(defaults.hit.profileLeft).toBeCloseTo(LEFT_AXIS_X - (FULL_LENGTH / 2) * (30 / 50), 9);
  expect(defaults.hit.profileRight).toBeCloseTo(LEFT_AXIS_X + FULL_LENGTH / 2, 9);
  expect(withColor(defaults.rows, DOWN_COLOR).every((row) => row.maxX <= LEFT_AXIS_X + 1e-9)).toBe(true);
  expect(withColor(defaults.rows, UP_COLOR).every((row) => row.minX >= LEFT_AXIS_X - 1e-9)).toBe(true);
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

test('the histogram box is the raised colour at alpha 00 by default, so it paints nothing', () => {
  expect(readFixedRangeProfileSettings(undefined).appearance.histogramBoxColor).toBe(`${palette.raised}00`);
  const { ops, hit } = paint();
  expect(ops.filter((op) => op.kind === 'fillRect')).toHaveLength(6);
  expect(hit.boxLeft).toBeUndefined();
});

test('the histogram box takes a stored #rrggbbaa colour and falls back to the default for an invalid one', () => {
  expect(readFixedRangeProfileSettings({ 'histogramBox.color': '#11223344' }).appearance.histogramBoxColor).toBe(
    '#11223344',
  );
  expect(readFixedRangeProfileSettings({ 'histogramBox.color': 'teal' }).appearance.histogramBoxColor).toBe(
    `${palette.raised}00`,
  );
});

test('the histogram box spans the range box and the bins, and is painted first under the bars', () => {
  const { ops, hit } = paint({ 'histogramBox.color': palette.raised });
  expect(hit.boxLeft).toBe(START_X);
  expect(hit.boxRight).toBe(END_X);
  expect(hit.boxTop).toBe(viewport.priceToY(170));
  expect(hit.boxBottom).toBe(viewport.priceToY(140));
  const boxOps = ops.filter((op) => op.kind === 'fillRect' && op.style === palette.raised);
  expect(boxOps).toHaveLength(1);
  expect([boxOps[0].minX, boxOps[0].maxX, boxOps[0].minY, boxOps[0].maxY]).toEqual([
    START_X,
    END_X,
    hit.boxTop,
    hit.boxBottom,
  ]);
  expect(ops.findIndex((op) => op.kind === 'fillRect')).toBe(ops.indexOf(boxOps[0]));
});

test('a fully transparent histogram box paints nothing and reports no box', () => {
  const { ops, hit } = paint({ 'histogramBox.color': '#ffffff00' });
  expect(ops.filter((op) => op.kind === 'fillRect')).toHaveLength(6);
  expect(hit.boxLeft).toBeUndefined();
});

test('there is no histogram box without bins, and none while previewing', () => {
  const { appearance } = readFixedRangeProfileSettings(undefined);
  for (const state of [
    { range: RANGE, profile: { ...PROFILE, bins: [] }, hit: {} },
    { range: RANGE, profile: PROFILE, previewing: true, hit: {} },
  ] satisfies FixedRangeProfileState[]) {
    const ops: PaintOp[] = [];
    drawFixedRangeProfile(
      createRecordingCtx((op) => ops.push(op)),
      renderArgsFor(viewport).viewport,
      state,
      appearance,
    );
    expect(ops).toEqual([]);
    expect(state.hit).toEqual({});
  }
});

test('placement right hangs the bars from the range end: mirrored for up/down, growing left otherwise', () => {
  const mirrored = paint({ placement: 'Right' });
  expect(mirrored.hit.anchorX).toBe(END_X);
  expect(mirrored.hit.profileLeft).toBeCloseTo(RIGHT_AXIS_X - (FULL_LENGTH / 2) * (30 / 50), 9);
  expect(mirrored.hit.profileRight).toBeCloseTo(END_X, 9);

  for (const volume of ['Total', 'Delta']) {
    const { hit, rows } = paint({ placement: 'Right', volume });
    expect(hit.anchorX).toBe(END_X);
    expect(hit.profileRight).toBe(END_X);
    expect(hit.profileLeft).toBeCloseTo(END_X - FULL_LENGTH, 9);
    expect(rows.every((row) => row.maxX <= END_X + 1e-9)).toBe(true);
  }
});

/** A profile whose largest down weight and largest up weight are equal, so a mirrored row can span the whole extent. */
const BALANCED_PROFILE = { ...PROFILE, bins: [bin(140, 150, 50, 5), bin(150, 160, 5, 50)] };

/** The leftmost and rightmost edge the histogram paints. */
function paintedBounds(stored: ToolInputValues): { left: number; right: number } {
  const state: FixedRangeProfileState = { range: RANGE, profile: { ...BALANCED_PROFILE, ...LEVELS }, hit: {} };
  const { appearance } = readFixedRangeProfileSettings(stored);
  drawFixedRangeProfile(
    createRecordingCtx(() => undefined),
    renderArgsFor(viewport).viewport,
    state,
    appearance,
  );
  return { left: state.hit.profileLeft!, right: state.hit.profileRight! };
}

test('the width percent is the share of the range the histogram spans, and the bars stay inside the range', () => {
  for (const volume of ['Up/Down', 'Total', 'Delta']) {
    for (const placement of ['Left', 'Right']) {
      for (const widthPercent of [1, 20, 100]) {
        // Every row of the balanced profile is the maximum of its mode (50 down or up, total 55, delta 45).
        const { left, right } = paintedBounds({ volume, placement, widthPercent });
        expect(Math.abs(right - left - (RANGE_WIDTH * widthPercent) / 100)).toBeLessThanOrEqual(1);
        expect(left).toBeGreaterThanOrEqual(START_X - 1e-9);
        expect(right).toBeLessThanOrEqual(END_X + 1e-9);
      }
    }
  }
});

test('at 100 percent the widest row spans the whole range, with no pixel cap', () => {
  for (const volume of ['Up/Down', 'Total', 'Delta']) {
    const { left, right } = paintedBounds({ volume, widthPercent: 100 });
    expect([left, right]).toEqual([START_X, END_X]);
  }
});

test('a one-sided bar takes the whole extent from its anchor', () => {
  expect(paint({ volume: 'Total', widthPercent: 10 }).hit.profileRight).toBeCloseTo(START_X + RANGE_WIDTH / 10, 9);
  expect(paint({ volume: 'Delta', widthPercent: 100 }).hit.profileRight).toBeCloseTo(END_X, 9);
});

test('the bars are clipped to the range box as well as to the pane, and the level lines are not', () => {
  const clips = paint().ops.filter((op) => op.kind === 'clip');
  expect(clips).toHaveLength(2);
  expect([clips[1].minX, clips[1].maxX]).toEqual([START_X, END_X]);
  expect(clips[0].minX).toBe(chartRect.x);
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

const VALUES_ON = { 'values.visible': true };

/** Paints the given bins under the stored settings and returns the value texts with the painted geometry. */
function paintValues(stored: ToolInputValues, bins: TickProfileBin[] = BINS) {
  const state: FixedRangeProfileState = { range: RANGE, profile: { ...PROFILE, ...LEVELS, bins }, hit: {} };
  const ops: PaintOp[] = [];
  const { appearance } = readFixedRangeProfileSettings(stored);
  drawFixedRangeProfile(
    createRecordingCtx((op) => ops.push(op), { recordClip: true }),
    renderArgsFor(viewport).viewport,
    state,
    appearance,
  );
  return { texts: ops.filter((op) => op.kind === 'fillText'), hit: state.hit, ops };
}

test('Values is off by default: no row labels and no totals line', () => {
  expect(readFixedRangeProfileSettings(undefined).appearance.valuesVisible).toBe(false);
  expect(readFixedRangeProfileSettings(undefined).appearance.valuesColor).toBe(palette.text);
  const { texts, hit } = paintValues({});
  expect(texts).toHaveLength(0);
  expect(hit.valueLabels).toBe(0);
  expect(hit.summaryY).toBeUndefined();
});

test('with tall rows Values paints one label per row and the totals line, in the values colour', () => {
  const { texts, hit } = paintValues({ ...VALUES_ON, 'values.color': '#112233' });
  expect(hit.valueLabels).toBe(3);
  // Bins are listed bottom first; rows are 40 px tall, so each label sits at its row's vertical middle.
  expect(texts.map((text) => text.text)).toEqual(['6×40', '30×12', '3×50', '39×102']);
  // The totals line (last) uses the same 11 px as the rows.
  expect(texts.every((text) => text.style === '#112233' && text.font === '400 11px system-ui, sans-serif')).toBe(true);
  expect(texts[0].y).toBe((viewport.priceToY(150) + viewport.priceToY(140)) / 2);
  expect(texts.every((text) => text.x === START_X + 4)).toBe(true);
  expect(hit.summaryY).toBe(viewport.priceToY(140) + 4);
  expect(texts[3].y).toBe(hit.summaryY);
});

test('placement right puts the labels 4 px inside the range end', () => {
  const { texts } = paintValues({ ...VALUES_ON, placement: 'Right' });
  expect(texts.every((text) => text.x === END_X - 4)).toBe(true);
});

test('Values Position defaults to On Profile and reads Opposite Side as the opposite edge', () => {
  expect(readFixedRangeProfileSettings(undefined).appearance.valuesSide).toBe('profile');
  expect(readFixedRangeProfileSettings({ valuesPosition: 'Opposite Side' }).appearance.valuesSide).toBe('opposite');
});

test('Opposite Side puts the labels and the totals line at the other edge of the range box', () => {
  const cases = [
    { placement: 'Left', x: END_X - 4, align: 'right' },
    { placement: 'Right', x: START_X + 4, align: 'left' },
  ];
  for (const { placement, x, align } of cases) {
    const { texts, hit } = paintValues({ ...VALUES_ON, placement, valuesPosition: 'Opposite Side' });
    expect(texts.every((text) => text.x === x)).toBe(true);
    expect(hit.valueLabelX).toBe(x);
    expect(hit.valueLabelAlign).toBe(align);
    expect(texts[0].y).toBe((viewport.priceToY(150) + viewport.priceToY(140)) / 2);
    expect(texts.at(-1)?.y).toBe(hit.summaryY);
  }
});

test('On Profile anchors the labels at the edge the bars hang from', () => {
  expect(paintValues(VALUES_ON).hit).toMatchObject({ valueLabelX: START_X + 4, valueLabelAlign: 'left' });
  expect(paintValues({ ...VALUES_ON, placement: 'Right' }).hit).toMatchObject({
    valueLabelX: END_X - 4,
    valueLabelAlign: 'right',
  });
});

test('the label text follows the volume mode, with a typographic minus for a negative delta', () => {
  expect(paintValues({ ...VALUES_ON, volume: 'Total' }).texts.map((text) => text.text)).toEqual([
    '46',
    '42',
    '53',
    '141',
  ]);
  expect(paintValues({ ...VALUES_ON, volume: 'Delta' }).texts.map((text) => text.text)).toEqual([
    '34',
    '−18',
    '47',
    '63',
  ]);
});

test('a row without volume gets no label, and fractional volumes are shortened', () => {
  const bins = [bin(140, 150, 0, 0), bin(150, 160, 1350.25, 0.126)];
  const { texts, hit } = paintValues(VALUES_ON, bins);
  expect(hit.valueLabels).toBe(1);
  expect(texts.map((text) => text.text)).toEqual(['1.35K×0.13', '1.35K×0.13']);
});

test('rows shorter than 11 px each get a label sized to the row height minus 1 px, and the totals use the same size', () => {
  // 2 price units are 8 px.
  const bins = [bin(140, 142, 6, 40), bin(142, 144, 30, 12)];
  const { texts, hit } = paintValues(VALUES_ON, bins);
  expect(hit.valueLabels).toBe(2);
  expect(texts.map((text) => text.text)).toEqual(['6×40', '30×12', '36×52']);
  expect(texts.map((text) => text.font)).toEqual([
    '400 7px system-ui, sans-serif',
    '400 7px system-ui, sans-serif',
    '400 7px system-ui, sans-serif',
  ]);
  expect(texts[0].y).toBe((viewport.priceToY(140) + viewport.priceToY(142)) / 2);
  expect(hit.summaryY).toBe(viewport.priceToY(140) + 4);
});

test('a row of 1 px or less still gets a 1 px label', () => {
  // 0.25 price units are 1 px.
  const { texts } = paintValues(VALUES_ON, [bin(140, 140.25, 6, 40)]);
  expect(texts[0].font).toBe('400 1px system-ui, sans-serif');
});

test('the value labels are painted after the bars and before the level lines, inside the range box clip', () => {
  const { ops } = paintValues(VALUES_ON);
  const indexesOf = (kind: PaintOp['kind']) => ops.flatMap((op, index) => (op.kind === kind ? [index] : []));
  const bars = indexesOf('fillRect');
  const texts = indexesOf('fillText');
  const lines = indexesOf('stroke');
  expect(bars.at(-1)).toBeLessThan(texts[0]);
  expect(texts.at(-1)).toBeLessThan(lines[0]);
  expect(ops.filter((op) => op.kind === 'clip')).toHaveLength(2);
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
