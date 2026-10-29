import { expect, test } from '@playwright/test';
import { profileResultFor } from './helpers/fakeMarketDataPort';
import { createRecordingCtx, createTestViewport, renderArgsFor, type PaintOp } from './helpers/overlayHarness';
import { drawFixedRangeProfile } from '../src/features/tools/fixedRangeProfile/fixedRangeProfileOverlay';
import type { FixedRangeProfileState } from '../src/features/tools/fixedRangeProfile/profileState';
import type { ToolInputValues } from '../src/features/chart/engine/drawings/toolInputs';
import { readFixedRangeProfileSettings } from '../src/features/tools/fixedRangeProfile/fixedRangeProfileSettings';
import type { TickProfileBin } from '../src/shared/bridge/types';
import { parseHexColor } from '../src/shared/theme/hexColor';
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
// Up/Down mirrors around the anchor line itself: the range start (Left) or the range end (Right).
const LEFT_AXIS_X = START_X;
const RIGHT_AXIS_X = END_X;

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
  // common maximum) takes half the extent and the down weight 30 takes 30/50 of that, around the anchor line.
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
  expect(mirrored.hit.profileRight).toBeCloseTo(RIGHT_AXIS_X + FULL_LENGTH / 2, 9);

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

test('the width percent is the share of the range the histogram spans: inward for Total and Delta, centred on the anchor line for Up/Down', () => {
  for (const volume of ['Up/Down', 'Total', 'Delta']) {
    for (const placement of ['Left', 'Right']) {
      for (const widthPercent of [1, 20, 100]) {
        // Every row of the balanced profile is the maximum of its mode (50 down or up, total 55, delta 45).
        const { left, right } = paintedBounds({ volume, placement, widthPercent });
        const extent = (RANGE_WIDTH * widthPercent) / 100;
        expect(Math.abs(right - left - extent)).toBeLessThanOrEqual(1);
        if (volume === 'Up/Down') {
          const anchorX = placement === 'Left' ? START_X : END_X;
          expect(left).toBeCloseTo(anchorX - extent / 2, 9);
          expect(right).toBeCloseTo(anchorX + extent / 2, 9);
        } else {
          expect(left).toBeGreaterThanOrEqual(START_X - 1e-9);
          expect(right).toBeLessThanOrEqual(END_X + 1e-9);
        }
      }
    }
  }
});

test('at 100 percent the widest row spans the whole range, with no pixel cap', () => {
  for (const volume of ['Total', 'Delta']) {
    const { left, right } = paintedBounds({ volume, widthPercent: 100 });
    expect([left, right]).toEqual([START_X, END_X]);
  }
  const mirrored = paintedBounds({ volume: 'Up/Down', widthPercent: 100 });
  expect([mirrored.left, mirrored.right]).toEqual([START_X - RANGE_WIDTH / 2, START_X + RANGE_WIDTH / 2]);
});

test('a one-sided bar takes the whole extent from its anchor', () => {
  expect(paint({ volume: 'Total', widthPercent: 10 }).hit.profileRight).toBeCloseTo(START_X + RANGE_WIDTH / 10, 9);
  expect(paint({ volume: 'Delta', widthPercent: 100 }).hit.profileRight).toBeCloseTo(END_X, 9);
});

test('the bars, labels and level lines are clipped to the pane only', () => {
  const clips = paint().ops.filter((op) => op.kind === 'clip');
  expect(clips).toHaveLength(1);
  expect([clips[0].minX, clips[0].maxX]).toEqual([chartRect.x, chartRect.x + chartRect.width]);
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

// Right is set explicitly: the default is Center, and these tests measure the column right of the anchor line.
const VALUES_ON = { 'values.visible': true, valuesPosition: 'Right' };
const HEADER_TEXT = 'Bid×Ask';
const HEADER_GAP = 4;
const HEADER_FONT_PX = 11;
const ROW_FONT = '400 11px system-ui, sans-serif';
const LABEL_GAP = 4;
// The recording context measures a text as 7 px per character. In Up/Down the widest text is the header
// `Bid×Ask` (7 characters, 49 px); the rows are `6×40` (28), `30×12` (35) and `3×50` (28), all centred in a
// 49 px column. In Total the widest is a row label such as `46` (2 characters, 14 px).
const WIDEST_TEXT = 7 * 7;
// Right of the anchor line the column starts LINE_GAP away, so its centre is anchor + 4 + 49 / 2.
const RIGHT_COLUMN_OFFSET = LABEL_GAP + WIDEST_TEXT / 2;

/**
 * Paints the given bins under the stored settings. `texts` are the row labels; the Bid×Ask headers
 * are returned apart, top header first.
 */
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
  const allTexts = ops.filter((op) => op.kind === 'fillText');
  return {
    texts: allTexts.filter((op) => op.text !== HEADER_TEXT),
    headers: allTexts.filter((op) => op.text === HEADER_TEXT),
    hit: state.hit,
    ops,
  };
}

test('Values is off by default: no row labels', () => {
  expect(readFixedRangeProfileSettings(undefined).appearance.valuesVisible).toBe(false);
  expect(readFixedRangeProfileSettings(undefined).appearance.valuesColor).toBe(palette.text);
  const { texts, hit } = paintValues({});
  expect(texts).toHaveLength(0);
  expect(hit.valueLabels).toBe(0);
});

test('with tall rows Up/Down paints one label per row, bid first', () => {
  const { texts, headers, hit } = paintValues({ ...VALUES_ON, 'values.color': '#112233' });
  expect(hit.valueLabels).toBe(3);
  // Bins are listed bottom first; rows are 40 px tall, so each label sits at its row's vertical middle.
  // Bid (down) first, then ask (up).
  expect(texts.map((text) => text.text)).toEqual(['6×40', '30×12', '3×50']);
  expect([...texts, ...headers].every((text) => text.style === '#112233' && text.font === ROW_FONT)).toBe(true);
  expect(texts[0].y).toBe((viewport.priceToY(150) + viewport.priceToY(140)) / 2);
  // The column centre: 73 + 4 + 49 / 2 = 101.5; every text, the 28 and 35 px rows too, is centred on it.
  expect([...texts, ...headers].every((text) => text.x === START_X + RIGHT_COLUMN_OFFSET)).toBe(true);
});

test('Total and Delta paint one label per row and nothing under the lowest row', () => {
  for (const volume of ['Total', 'Delta']) {
    const { texts, hit } = paintValues({ ...VALUES_ON, volume });
    expect(texts, volume).toHaveLength(3);
    expect(
      texts.every((text) => text.font === ROW_FONT),
      volume,
    ).toBe(true);
    expect(hit.valuesColumnBottom, volume).toBe(viewport.priceToY(140));
  }
});

test('placement right starts the label column 4 px right of the range end', () => {
  const { texts } = paintValues({ ...VALUES_ON, placement: 'Right' });
  expect(texts.every((text) => text.x === END_X + RIGHT_COLUMN_OFFSET)).toBe(true);
});

test('Values Position defaults to Center and reads Left and Right; the old stored options read as the default', () => {
  expect(readFixedRangeProfileSettings(undefined).appearance.valuesSide).toBe('center');
  expect(readFixedRangeProfileSettings({ valuesPosition: 'Left' }).appearance.valuesSide).toBe('left');
  expect(readFixedRangeProfileSettings({ valuesPosition: 'Right' }).appearance.valuesSide).toBe('right');
  expect(readFixedRangeProfileSettings({ valuesPosition: 'Opposite Side' }).appearance.valuesSide).toBe('center');
  expect(readFixedRangeProfileSettings({ valuesPosition: 'On Profile' }).appearance.valuesSide).toBe('center');
});

test('Values Position Right keeps the labels right of the anchor line in every volume mode', () => {
  // Column centre = anchor + 4 + widest / 2, the widest text being its characters * 7 (the recording ctx).
  const widestCharacters = { 'Up/Down': 7, Total: 2, Delta: 3 };
  for (const [volume, characters] of Object.entries(widestCharacters)) {
    const { texts, headers, hit } = paintValues({ 'values.visible': true, valuesPosition: 'Right', volume });
    const centerX = START_X + LABEL_GAP + (characters * 7) / 2;
    expect(
      [...texts, ...headers].every((text) => text.x === centerX),
      volume,
    ).toBe(true);
    expect(hit.valueLabelX, volume).toBe(centerX);
  }
});

test('with Values on and no Values Position stored, the labels and headers centre on the anchor line', () => {
  const { texts, headers, hit } = paintValues({ 'values.visible': true });
  expect([...texts, ...headers].every((text) => text.x === START_X)).toBe(true);
  expect(hit).toMatchObject({ valueLabelX: START_X, valueLabelAlign: 'center' });
});

test('Left ends the label column 4 px left of the anchor line, texts centred in it', () => {
  // The column centre: anchor - 4 - 49 / 2 = anchor - 28.5.
  const cases = [
    { placement: 'Left', x: START_X - RIGHT_COLUMN_OFFSET },
    { placement: 'Right', x: END_X - RIGHT_COLUMN_OFFSET },
  ];
  for (const { placement, x } of cases) {
    const { texts, hit } = paintValues({ ...VALUES_ON, placement, valuesPosition: 'Left' });
    expect(texts.every((text) => text.x === x)).toBe(true);
    expect(hit.valueLabelX).toBe(x);
    expect(hit.valueLabelAlign).toBe('center');
    expect(texts[0].y).toBe((viewport.priceToY(150) + viewport.priceToY(140)) / 2);
  }
});

test('Right starts the label column 4 px right of the anchor line, texts centred in it', () => {
  expect(paintValues(VALUES_ON).hit).toMatchObject({
    valueLabelX: START_X + RIGHT_COLUMN_OFFSET,
    valueLabelAlign: 'center',
  });
  expect(paintValues({ ...VALUES_ON, placement: 'Right' }).hit).toMatchObject({
    valueLabelX: END_X + RIGHT_COLUMN_OFFSET,
    valueLabelAlign: 'center',
  });
});

test('the column is as wide as the widest text of the mode: Total centres on 73 + 4 + 14 / 2', () => {
  const { texts, hit } = paintValues({ ...VALUES_ON, volume: 'Total' });
  const centerX = START_X + LABEL_GAP + WIDEST_TOTAL_TEXT / 2;
  expect(centerX).toBe(84);
  expect(texts.every((text) => text.x === centerX)).toBe(true);
  expect(hit.valueLabelX).toBe(centerX);
});

test('Center puts the labels and the headers on the anchor line, centre-aligned', () => {
  const { texts, headers, hit } = paintValues({ ...VALUES_ON, valuesPosition: 'Center' });
  expect([...texts, ...headers].every((text) => text.x === START_X)).toBe(true);
  expect(hit).toMatchObject({ valueLabelX: START_X, valueLabelAlign: 'center' });
});

test('in Up/Down two Bid×Ask headers frame the labels: one above the highest row, one under the lowest row', () => {
  const { headers, hit } = paintValues(VALUES_ON);
  const highestRowTop = viewport.priceToY(170);
  const lowestRowBottom = viewport.priceToY(140);
  expect(headers.map((header) => header.y)).toEqual([highestRowTop - HEADER_GAP, lowestRowBottom + HEADER_GAP]);
  expect(headers.map((header) => header.font)).toEqual([ROW_FONT, ROW_FONT]);
  expect(hit.headerTopY).toBe(highestRowTop - HEADER_GAP);
  expect(hit.headerBottomY).toBe(lowestRowBottom + HEADER_GAP);
});

test('Total and Delta paint no headers', () => {
  for (const volume of ['Total', 'Delta']) {
    const { headers, hit } = paintValues({ ...VALUES_ON, volume });
    expect(headers).toHaveLength(0);
    expect([hit.headerTopY, hit.headerBottomY]).toEqual([undefined, undefined]);
  }
});

const BACKGROUND_COLOR = '#112233ff';
const WITH_BACKGROUND = { ...VALUES_ON, 'valuesBackground.color': BACKGROUND_COLOR };

/** The one rect painted in the values background colour, and the hit fields that report it. */
function valuesBox(stored: ToolInputValues) {
  const { ops, hit } = paintValues(stored);
  const boxes = ops.filter((op) => op.kind === 'fillRect' && op.style === BACKGROUND_COLOR);
  return { ops, hit, boxes };
}

const WIDEST_TOTAL_TEXT = 2 * 7;

test('Values Background is transparent by default and paints no extra rect', () => {
  const { appearance } = readFixedRangeProfileSettings(undefined);
  expect(parseHexColor(appearance.valuesBackgroundColor)?.alpha).toBe(0);
  const withoutColor = paintValues(VALUES_ON);
  const withDefault = paint({ ...VALUES_ON, 'valuesBackground.color': appearance.valuesBackgroundColor });
  expect(withoutColor.ops.filter((op) => op.kind === 'fillRect')).toHaveLength(6);
  expect(withDefault.rows).toHaveLength(6);
  expect(withoutColor.hit.valuesBoxLeft).toBeUndefined();
});

test('Values Background on the right paints one box from the anchor line past the widest text, before the texts', () => {
  const { ops, hit, boxes } = valuesBox(WITH_BACKGROUND);
  expect(boxes).toHaveLength(1);
  // Right of the anchor: x from 73 to textX 77 + widest (the 49 px header) 49 + gap 4 = 130.
  // Vertically from the top of the top header (highest row top - 4 - 11) to the bottom of the bottom
  // header (lowest row bottom + 4 + 11): the headers count in the box, in height and in width.
  const top = viewport.priceToY(170) - HEADER_GAP - HEADER_FONT_PX;
  const bottom = viewport.priceToY(140) + HEADER_GAP + HEADER_FONT_PX;
  expect([boxes[0].minX, boxes[0].maxX]).toEqual([START_X, START_X + LABEL_GAP + WIDEST_TEXT + LABEL_GAP]);
  expect([boxes[0].minY, boxes[0].maxY]).toEqual([top, bottom]);
  expect(hit).toMatchObject({
    valuesBoxLeft: START_X,
    valuesBoxRight: 130,
    valuesBoxTop: top,
    valuesBoxBottom: bottom,
  });
  const boxIndex = ops.findIndex((op) => op === boxes[0]);
  const barIndexes = ops.flatMap((op, index) => (op.kind === 'fillRect' && op !== boxes[0] ? [index] : []));
  expect(boxIndex).toBeGreaterThan(Math.max(...barIndexes));
  expect(boxIndex).toBeLessThan(ops.findIndex((op) => op.kind === 'fillText'));
});

test('Values Background on the left ends at the anchor line and starts past the widest text', () => {
  const { hit, boxes } = valuesBox({ ...WITH_BACKGROUND, valuesPosition: 'Left' });
  expect(boxes).toHaveLength(1);
  // Left of the anchor: textX 73 - 4 = 69, minus widest 49 and gap 4 = 16, up to the anchor 73.
  expect([boxes[0].minX, boxes[0].maxX]).toEqual([START_X - LABEL_GAP - WIDEST_TEXT - LABEL_GAP, START_X]);
  expect([hit.valuesBoxLeft, hit.valuesBoxRight]).toEqual([16, START_X]);
});

test('Values Background centred spans the anchor line by half the widest text plus the gap on each side', () => {
  const { hit, boxes } = valuesBox({ ...WITH_BACKGROUND, valuesPosition: 'Center' });
  expect(boxes).toHaveLength(1);
  // Widest 49 / 2 = 24.5, plus gap 4 = 28.5 each side of the anchor 73: from 44.5 to 101.5.
  expect([boxes[0].minX, boxes[0].maxX]).toEqual([44.5, 101.5]);
  expect([hit.valuesBoxLeft, hit.valuesBoxRight]).toEqual([44.5, 101.5]);
});

test('the values column is reported with a transparent background too, and equals the box when one paints', () => {
  const transparent = paintValues(VALUES_ON).hit;
  expect(transparent.valuesBoxLeft).toBeUndefined();
  // The column of the Values Background tests above: 73 to 130 horizontally, headers included vertically.
  const column = {
    valuesColumnLeft: START_X,
    valuesColumnRight: 130,
    valuesColumnTop: viewport.priceToY(170) - HEADER_GAP - HEADER_FONT_PX,
    valuesColumnBottom: viewport.priceToY(140) + HEADER_GAP + HEADER_FONT_PX,
  };
  expect(transparent).toMatchObject(column);
  expect(valuesBox(WITH_BACKGROUND).hit).toMatchObject({
    ...column,
    valuesBoxLeft: column.valuesColumnLeft,
    valuesBoxRight: column.valuesColumnRight,
    valuesBoxTop: column.valuesColumnTop,
    valuesBoxBottom: column.valuesColumnBottom,
  });
});

test('hidden Values reports no values column', () => {
  const { hit } = paintValues({});
  expect([hit.valuesColumnLeft, hit.valuesColumnRight, hit.valuesColumnTop, hit.valuesColumnBottom]).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

test('the painted histogram extent is reported: the bars horizontally, the rows vertically', () => {
  const { hit } = paint();
  expect([hit.profileTop, hit.profileBottom]).toEqual([viewport.priceToY(170), viewport.priceToY(140)]);
  expect(hit.profileLeft).toBeLessThan(START_X);
  expect(hit.profileRight).toBeGreaterThan(START_X);
});

test('without headers the box covers the highest row down to the lowest row', () => {
  const { hit, boxes } = valuesBox({ ...WITH_BACKGROUND, volume: 'Total' });
  expect(boxes).toHaveLength(1);
  // Widest is a row label such as `46`: 14 px; right of the anchor 73 -> 77 + 14 + 4 = 95.
  expect([boxes[0].minX, boxes[0].maxX]).toEqual([START_X, START_X + LABEL_GAP + WIDEST_TOTAL_TEXT + LABEL_GAP]);
  expect([hit.valuesBoxTop, hit.valuesBoxBottom]).toEqual([viewport.priceToY(170), viewport.priceToY(140)]);
});

test('without headers the Delta box also ends at the lowest row', () => {
  const { hit } = valuesBox({ ...WITH_BACKGROUND, volume: 'Delta' });
  expect([hit.valuesBoxTop, hit.valuesBoxBottom]).toEqual([viewport.priceToY(170), viewport.priceToY(140)]);
});

test('hidden Values paints no background even with a colour', () => {
  const { boxes, hit } = valuesBox({ 'valuesBackground.color': BACKGROUND_COLOR });
  expect(boxes).toHaveLength(0);
  expect(hit.valuesBoxLeft).toBeUndefined();
});

test('an invalid Values Background colour reads as the transparent default', () => {
  const { appearance } = readFixedRangeProfileSettings({ 'valuesBackground.color': 'not a colour' });
  expect(appearance.valuesBackgroundColor).toBe(
    readFixedRangeProfileSettings(undefined).appearance.valuesBackgroundColor,
  );
  expect(parseHexColor(appearance.valuesBackgroundColor)?.alpha).toBe(0);
});

test('the label text follows the volume mode, with a typographic minus for a negative delta', () => {
  expect(paintValues({ ...VALUES_ON, volume: 'Total' }).texts.map((text) => text.text)).toEqual(['46', '42', '53']);
  expect(paintValues({ ...VALUES_ON, volume: 'Delta' }).texts.map((text) => text.text)).toEqual(['34', '−18', '47']);
});

test('a row without volume gets no label, and fractional volumes are shortened', () => {
  const bins = [bin(140, 150, 0, 0), bin(150, 160, 1350.25, 0.126)];
  const { texts, hit } = paintValues(VALUES_ON, bins);
  expect(hit.valueLabels).toBe(1);
  expect(texts.map((text) => text.text)).toEqual(['1.35K×0.13']);
});

test('rows shorter than 11 px each get a label sized to the row height minus 1 px, and the headers use the same size', () => {
  // 2 price units are 8 px.
  const bins = [bin(140, 142, 6, 40), bin(142, 144, 30, 12)];
  const { texts, headers, hit } = paintValues(VALUES_ON, bins);
  expect(hit.valueLabels).toBe(2);
  expect(texts.map((text) => text.text)).toEqual(['6×40', '30×12']);
  expect([...texts, ...headers].map((text) => text.font)).toEqual(Array(4).fill('400 7px system-ui, sans-serif'));
  expect(texts[0].y).toBe((viewport.priceToY(140) + viewport.priceToY(142)) / 2);
  expect(hit.headerBottomY).toBe(viewport.priceToY(140) + HEADER_GAP);
});

test('a row of 1 px or less still gets a 1 px label', () => {
  // 0.25 price units are 1 px.
  const { texts } = paintValues(VALUES_ON, [bin(140, 140.25, 6, 40)]);
  expect(texts[0].font).toBe('400 1px system-ui, sans-serif');
});

test('the value labels are painted after the bars and before the level lines, under the pane clip only', () => {
  const { ops } = paintValues(VALUES_ON);
  const indexesOf = (kind: PaintOp['kind']) => ops.flatMap((op, index) => (op.kind === kind ? [index] : []));
  const bars = indexesOf('fillRect');
  const texts = indexesOf('fillText');
  const lines = indexesOf('stroke');
  expect(bars.at(-1)).toBeLessThan(texts[0]);
  expect(texts.at(-1)).toBeLessThan(lines[0]);
  expect(ops.filter((op) => op.kind === 'clip')).toHaveLength(1);
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
