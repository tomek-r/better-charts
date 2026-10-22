import { palette } from '../src/shared/theme/palette';
import { test, expect } from '@playwright/test';
import {
  createRecordingCtx,
  createTestViewport,
  renderArgsFor,
  type PaintOp,
  type TestViewport,
} from './helpers/overlayHarness';
import {
  drawFixedRangeProfile,
  drawFixedRangeProfileSpinner,
  drawFixedRangeProfileLoadingWash,
  LOADING_WASH_ALPHA,
  type FixedRangeProfileState,
  type HandleEdges,
} from '../src/features/tools/fixedRangeProfile/overlay';
import {
  drawLoader,
  LOADER_LINE_MARGIN,
  LOADER_MAX_WIDTH,
  LOADER_MIN_WIDTH,
  LOADER_ROW_COUNT,
  LOADER_ROW_GAP,
  LOADER_ROW_HEIGHT,
  loaderRowWidths,
} from '../src/shared/canvas/loader';
import type { ProfileResult, TickProfileBin } from '../src/shared/bridge/types';
import { formatDayMonth, MS_PER_DAY, STUB_NOW } from './helpers/stubClock';

/**
 * Geometry + paint-order regression for the fixed-range volume-profile overlay.
 * Pure Node spec (no page): a recording 2D-context captures every clip,
 * fillRect, stroke and fillText with its color, alpha, dash and exact extents,
 * so the assertions run on the recorded op sequence — exactly what the pixels
 * would show.
 *
 * Contract locked down here (see tools/fixedRangeProfile/overlay.ts):
 *  - time→x anchor = the public viewport mapping (bar center): chartRect.x + i*(barWidth+barSpacing) - offset + barWidth/2,
 *    with i located by binary search over bar times (interpolate inside, clamp outside);
 *  - mirrored rows around the anchor (BID left / ASK right), ONE common weight denominator;
 *  - POC row alpha 1 vs 0.75 for every other row, whole paint clipped to chartRect;
 *  - level lines from the range start (anchorX) to the chartRect's right edge, painted AFTER the rows — POC solid, VAH/VAL dashed [4,3]; NO text labels;
 *  - null range / missing profile / empty bins → zero paint ops and an empty `hit`.
 */

type Op = PaintOp;

// ---------------------------------------------------------------------------
// Fixture: 10 bars 60s apart, linear price scale 100–200 → priceY(p) = 45 + (200-p)*4.
// ---------------------------------------------------------------------------
const viewport = createTestViewport({ offset: 7, visibleRange: { from: 0, to: 9 }, scaleMode: 'regular' });
const { chartRect } = viewport;
const BAR_INTERVAL = 60_000;
const bars = Array.from({ length: 10 }, (_, i) => ({
  time: 1_000 + i * BAR_INTERVAL,
  open: 1,
  high: 1,
  low: 1,
  close: 1,
  volume: 1,
}));

// Mid-bar 3 → fractional index 3.5 → anchorX = 41 + 3.5*10 - 7 + 8/2 = 73.
const RANGE_FROM = bars[3].time + 30_000;
const ANCHOR_X = 73;

const BID_COLOR = '#f7525f';
const ASK_COLOR = '#26a69a';

// maxWeight = 50, half = min(180, 600*0.2) = 120.
// bid widths 14.4/28.8/7.2 (maxBid 28.8 → profileLeft ≈ 44.2); ask widths 96/28.8/120 (maxAsk 120 → profileRight = 193).
// Row geometry (priceY): tops 245/205/165, bottom = top+40 → drawHeight 39.
const TICK_SOURCE = { source: 'ticks', barTimeframe: null, coveredFromMs: null } as const;
const BAR_SOURCE = { source: 'bars', barTimeframe: 'M1', coveredFromMs: null } as const;
// History starts ten days ago, inside the range: the label names the first covered day.
const COVERED_FROM_MS = STUB_NOW - 10 * MS_PER_DAY;
const PARTIAL_BAR_SOURCE = {
  source: 'bars',
  barTimeframe: 'M2',
  coveredFromMs: COVERED_FROM_MS,
} as const;
const DEFAULT_BINS: TickProfileBin[] = [
  { low: '140.00', high: '150.00', total: '10', bid: '6', ask: '40' },
  { low: '150.00', high: '160.00', total: '10', bid: '12', ask: '12' },
  { low: '160.00', high: '170.00', total: '10', bid: '3', ask: '50' },
];

function makeProfile(
  bins: TickProfileBin[],
  source: Pick<ProfileResult, 'source' | 'barTimeframe' | 'coveredFromMs'> = TICK_SOURCE,
): ProfileResult {
  return {
    ...source,
    symbol: 'DEMO.TEST',
    fromMs: RANGE_FROM,
    endMs: RANGE_FROM + 5 * BAR_INTERVAL,
    complete: true,
    rejectedTicks: 0,
    actualRows: bins.length,
    totalWeight: 0,
    // priceY: 155 → 225, 165 → 185, 145 → 265.
    poc: '155.00',
    vah: '165.00',
    val: '145.00',
    bidLevels: null,
    askLevels: null,
    bins,
  };
}

const recordInto = (ops: Op[]) => createRecordingCtx((op) => ops.push(op), { recordClip: true });

function makeState(profile?: ProfileResult): FixedRangeProfileState {
  return { range: { fromMs: RANGE_FROM, toMs: RANGE_FROM + 5 * BAR_INTERVAL }, profile, hit: {} };
}

function paint(
  profile?: ProfileResult,
  vp: TestViewport = viewport,
  range?: FixedRangeProfileState['range'],
): { ops: Op[]; state: FixedRangeProfileState } {
  const state = makeState(profile);
  if (range !== undefined) {
    state.range = range;
  }
  const args = renderArgsFor(vp);
  const ops: Op[] = [];
  drawFixedRangeProfile(recordInto(ops), args.viewport, state);
  return { ops, state };
}

const rowsOf = (ops: Op[]) => ops.filter((op) => op.kind === 'fillRect');
const linesOf = (ops: Op[]) => ops.filter((op) => op.kind === 'stroke');
const labelsOf = (ops: Op[]) => ops.filter((op) => op.kind === 'fillText');

// ---------------------------------------------------------------------------
// (a) Mirrored geometry + verified time→x anchor.
// ---------------------------------------------------------------------------
test('anchor maps range.fromMs through the public time-to-coordinate mapping', () => {
  // Mid-bar interpolation: index 3.5 → 41 + 35 - 7 + 4 = 73; the formula
  // carries `- offset + barWidth/2` (library bar CENTER, not the bar's left edge).
  expect(paint(makeProfile(DEFAULT_BINS)).state.hit.anchorX).toBe(ANCHOR_X);

  // The mapping is viewport-relative, not a hard-coded constant.
  expect(paint(makeProfile(DEFAULT_BINS), { ...viewport, offset: 57 }).state.hit.anchorX).toBe(41 + 3.5 * 10 - 57 + 4); // 23

  // Exact bar time → integer index (bar 2 → 58).
  const exact = paint(makeProfile(DEFAULT_BINS), viewport, { fromMs: bars[2].time, toMs: bars[4].time });
  expect(exact.state.hit.anchorX).toBe(41 + 2 * 10 - 7 + 4); // 58

  // Outside the data range → clamped to first / last bar (38 / 128).
  const before = paint(makeProfile(DEFAULT_BINS), viewport, { fromMs: bars[0].time - 100_000, toMs: bars[0].time });
  expect(before.state.hit.anchorX).toBe(41 - 7 + 4);
  const after = paint(makeProfile(DEFAULT_BINS), viewport, {
    fromMs: bars[9].time + 100_000,
    toMs: bars[9].time + 200_000,
  });
  expect(after.state.hit.anchorX).toBe(41 + 9 * 10 - 7 + 4);
});

test('every bid row lies left of the anchor, every ask row right of it', () => {
  const { ops, state } = paint(makeProfile(DEFAULT_BINS));
  const rows = rowsOf(ops);
  expect(rows).toHaveLength(6); // 3 bins × 2 sides, all weights > 0

  let bids = 0;
  let asks = 0;
  for (const row of rows) {
    const leftOf = row.minX < ANCHOR_X && row.maxX <= ANCHOR_X + 1e-9;
    const rightOf = row.minX >= ANCHOR_X - 1e-9 && row.maxX > ANCHOR_X;
    // Exactly one side: no row may straddle the anchor, none is zero-width.
    expect(Number(leftOf) + Number(rightOf)).toBe(1);
    expect(row.maxX - row.minX).toBeGreaterThan(0);
    if (leftOf) {
      bids += 1;
    } else {
      asks += 1;
    }
  }
  expect(bids).toBe(3);
  expect(asks).toBe(3);

  // hit geometry: profileLeft = anchor − maxBidWidth(28.8) ≈ 44.2, profileRight = anchor + maxAskWidth(120) = 193.
  expect(state.hit.anchorX).toBe(ANCHOR_X);
  expect(state.hit.profileLeft).toBeCloseTo(ANCHOR_X - 28.8, 9);
  expect(state.hit.profileRight).toBe(ANCHOR_X + 120);
});

test('with bid === ask the two rows are symmetric around the anchor', () => {
  const bins: TickProfileBin[] = [
    { low: '140.00', high: '150.00', total: '2', bid: '12', ask: '12' },
    { low: '150.00', high: '160.00', total: '4', bid: '4', ask: '4' },
  ];
  const rows = rowsOf(paint(makeProfile(bins)).ops);
  expect(rows).toHaveLength(4);

  const bidRows = rows.filter((r) => r.maxX <= ANCHOR_X + 1e-9);
  const askRows = rows.filter((r) => r.minX >= ANCHOR_X - 1e-9);
  expect(bidRows).toHaveLength(2);
  expect(askRows).toHaveLength(2);
  for (const bid of bidRows) {
    const twin = askRows.find((ask) => ask.minY === bid.minY);
    expect(twin).toBeDefined();
    // Mirror symmetry: left extent == right extent for the same row.
    expect(ANCHOR_X - bid.minX).toBeCloseTo((twin as Op).maxX - ANCHOR_X, 9);
  }
});

// ---------------------------------------------------------------------------
// (b) Colors.
// ---------------------------------------------------------------------------
test('bid rows paint #f7525f, ask rows #26a69a, nothing else', () => {
  const rows = rowsOf(paint(makeProfile(DEFAULT_BINS)).ops);
  const styles = new Set(rows.map((r) => r.style));
  expect([...styles].sort()).toEqual([ASK_COLOR, BID_COLOR].sort());
  for (const row of rows) {
    if (row.style === BID_COLOR) {
      expect(row.maxX).toBeLessThanOrEqual(ANCHOR_X + 1e-9);
    } // left side
    else {
      expect(row.minX).toBeGreaterThanOrEqual(ANCHOR_X - 1e-9);
    } // right side
  }
});

// ---------------------------------------------------------------------------
// (c) Level lines run rangeStart(anchorX) → chartRect right edge — POC solid, VAH/VAL dashed; no text labels.
// ---------------------------------------------------------------------------
test('level lines run from the range start (anchorX) to the chartRect right edge — POC solid, VAH/VAL dashed', () => {
  const { ops, state } = paint(makeProfile(DEFAULT_BINS));
  const lines = linesOf(ops);
  expect(lines).toHaveLength(3);
  // Fixture: the range starts at the anchor — lines begin at anchorX = 73.
  const anchorX = state.hit.anchorX ?? Number.NaN;
  expect(anchorX).toBeCloseTo(ANCHOR_X, 9);
  for (const line of lines) {
    expect(line.minX).toBeCloseTo(anchorX, 9);
    expect(line.maxX).toBe(chartRect.x + chartRect.width);
    // POC is solid; VAH/VAL keep the [4, 3] dash (owner).
    const isPoc = line.style === '#ffd200';
    expect(line.dashed).toBe(!isPoc);
    expect(line.dash).toEqual(isPoc ? [] : [4, 3]);
  }
  // POC yellow at y 225; VAH/VAL near-white at 185 / 265.
  expect(lines.find((l) => l.style === '#ffd200')?.minY).toBeCloseTo(225, 6);
  expect(
    lines
      .filter((l) => l.style === '#f2f5fa')
      .map((l) => Math.round(l.minY))
      .sort((a, b) => a - b),
  ).toEqual([185, 265]);
});

test('a bars profile paints only its bar timeframe, muted, in the top-left of the range band', () => {
  const { ops } = paint(makeProfile(DEFAULT_BINS, BAR_SOURCE));
  const labels = labelsOf(ops);
  expect(labels).toHaveLength(1);
  const [label] = labels;
  expect(label.text).toBe('M1');
  expect(label.style).toBe('#718099');
  expect(label.font).toBe('400 11px system-ui, sans-serif');
  expect(label.alpha).toBe(1);
  // Band starts at the anchor; the label sits 6px inside it, 6px below the pane top (clipped to the pane).
  expect(label.x).toBe(ANCHOR_X + 6);
  expect(label.y).toBe(chartRect.y + 6);
  // Rows and levels are painted exactly as for ticks; the label comes after them.
  expect(ops.indexOf(label)).toBe(ops.length - 1);
  expect(rowsOf(ops)).toHaveLength(6);
});

test('a partial bars profile names where its coverage starts, in the warning colour', () => {
  const { ops } = paint(makeProfile(DEFAULT_BINS, PARTIAL_BAR_SOURCE));
  const labels = labelsOf(ops);
  const [timeframePart, coveredFromPart] = labels;
  // Two parts of one label — the diamond separator sits between them, so the covered day is a part of its own.
  expect(labels.map((label) => label.text)).toEqual(['M2', `from ${formatDayMonth(COVERED_FROM_MS)}`]);
  for (const label of labels) {
    expect(label.style).toBe('#ffd28a');
    expect(label.font).toBe('400 11px system-ui, sans-serif');
    expect(label.y).toBe(chartRect.y + 6);
  }
  // The label starts 6px inside the band, which starts at the anchor.
  expect(timeframePart.x).toBe(ANCHOR_X + 6);
  // One filled diamond, in the label colour, sitting between the two parts.
  const separators = ops.filter((op) => op.kind === 'fill');
  expect(separators).toHaveLength(1);
  expect(separators[0].style).toBe('#ffd28a');
  expect(separators[0].minX).toBeGreaterThan(ANCHOR_X + 6);
  expect(coveredFromPart.x).toBeGreaterThan(separators[0].maxX);
});

test('a partial label uses the UTC day and a short English month', () => {
  const coveredDayFor = (coveredFromMs: number) =>
    labelsOf(paint(makeProfile(DEFAULT_BINS, { ...PARTIAL_BAR_SOURCE, coveredFromMs })).ops)[1].text;
  // Pinned because the subject is the label at the year edges: the first and last UTC minute of a year.
  expect(coveredDayFor(Date.UTC(2026, 0, 1, 0, 0))).toBe('from 1 Jan');
  expect(coveredDayFor(Date.UTC(2026, 11, 31, 23, 59))).toBe('from 31 Dec');
});

test('a bars profile whose band starts left of the pane keeps its label inside the pane', () => {
  const offscreen = { fromMs: bars[0].time - 100_000, toMs: bars[4].time };
  const { ops } = paint(makeProfile(DEFAULT_BINS, BAR_SOURCE), viewport, offscreen);
  const [label] = labelsOf(ops);
  expect(label.x).toBe(chartRect.x + 6);
});

test('a tick profile paints no timeframe label', () => {
  expect(labelsOf(paint(makeProfile(DEFAULT_BINS, TICK_SOURCE)).ops)).toHaveLength(0);
});

test('no text labels are painted; paint order is rows then level lines, clipped to chartRect', () => {
  const { ops } = paint(makeProfile(DEFAULT_BINS));
  const rows = rowsOf(ops);
  const lines = linesOf(ops);
  // Owner removed the level labels — the overlay must emit no fillText at all.
  expect(labelsOf(ops)).toHaveLength(0);

  // Paint order is the contract: rows → level lines; clip first of all.
  expect(ops[0].kind).toBe('clip');
  expect(rows.every((r) => r.kind === 'fillRect')).toBe(true);
  const lastRow = ops.map((op) => op.kind).lastIndexOf('fillRect');
  const firstLine = ops.map((op) => op.kind).indexOf('stroke');
  const lastLine = ops.map((op) => op.kind).lastIndexOf('stroke');
  expect(lastRow).toBeLessThan(firstLine);
  expect(lines).toHaveLength(3);
  expect(lastLine).toBe(ops.length - 1);

  // The clip covers exactly chartRect (whole paint clipped).
  expect(ops[0].minX).toBe(chartRect.x);
  expect(ops[0].maxX).toBe(chartRect.x + chartRect.width);
  expect(ops[0].minY).toBe(chartRect.y);
  expect(ops[0].maxY).toBe(chartRect.y + chartRect.height);
});

// ---------------------------------------------------------------------------
// (d) POC row alpha.
// ---------------------------------------------------------------------------
test('the POC bin row paints at alpha 1, every other row at 0.75', () => {
  const rows = rowsOf(paint(makeProfile(DEFAULT_BINS)).ops);
  expect(rows).toHaveLength(6);
  // POC 155.00 lives in bin 150–160 → its rows start at priceY(160) = 205.
  const pocRows = rows.filter((r) => Math.abs(r.minY - 205) < 1e-6);
  expect(pocRows).toHaveLength(2);
  for (const row of pocRows) {
    expect(row.alpha).toBe(1);
  }
  const otherRows = rows.filter((r) => Math.abs(r.minY - 205) >= 1e-6);
  expect(otherRows).toHaveLength(4);
  for (const row of otherRows) {
    expect(row.alpha).toBe(0.75);
  }
});

// ---------------------------------------------------------------------------
// (e) Nothing to paint.
// ---------------------------------------------------------------------------
test('null range, missing profile or empty bins → zero paint ops and an empty hit', () => {
  const cases: FixedRangeProfileState[] = [
    { range: null, profile: makeProfile(DEFAULT_BINS), hit: {} },
    makeState(undefined),
    makeState(makeProfile([])),
  ];
  for (const state of cases) {
    const ops: Op[] = [];
    drawFixedRangeProfile(recordInto(ops), renderArgsFor(viewport).viewport, state);
    expect(ops).toHaveLength(0);
    expect(state.hit).toEqual({});
  }
});

// ---------------------------------------------------------------------------
// (f) Edge cases: zero-bid bin, string weights parsing.
// ---------------------------------------------------------------------------
test('a bin with zero bid paints only the ask side', () => {
  const bins: TickProfileBin[] = [{ low: '140.00', high: '160.00', total: '5', bid: '0', ask: '50' }];
  const { ops, state } = paint(makeProfile(bins));
  const rows = rowsOf(ops);
  expect(rows).toHaveLength(1);
  expect(rows[0].style).toBe(ASK_COLOR);
  expect(rows[0].minX).toBe(ANCHOR_X);
  expect(rows[0].maxX).toBeCloseTo(ANCHOR_X + 120, 9); // half × 50/50 = 120
  expect(ops.some((op) => op.style === BID_COLOR)).toBe(false);
  // No bid side → profileLeft collapses onto the anchor; right edge = anchor + 120.
  expect(state.hit.profileLeft).toBe(ANCHOR_X);
  expect(state.hit.profileRight).toBeCloseTo(ANCHOR_X + 120, 9);
});

test('weights arriving as strings parse exactly like numbers', () => {
  const stringProfile = makeProfile([{ low: '140.00', high: '160.00', total: '12', bid: '12', ask: '6' }]);
  const numberProfile = {
    ...makeProfile([]),
    bins: [{ low: 140, high: 160, total: 12, bid: 12, ask: 6 }],
  } as unknown as ProfileResult;

  const fromStrings = paint(stringProfile);
  const fromNumbers = paint(numberProfile);
  expect(fromStrings.ops).toEqual(fromNumbers.ops); // identical paint for identical weights

  // And the widths prove the parse: maxWeight 12 → bid 120, ask 60.
  const rows = rowsOf(fromStrings.ops);
  expect(rows).toHaveLength(2);
  const bid = rows.find((r) => r.style === BID_COLOR);
  const ask = rows.find((r) => r.style === ASK_COLOR);
  expect(ANCHOR_X - (bid as Op).minX).toBeCloseTo(120, 9);
  expect((ask as Op).maxX - ANCHOR_X).toBeCloseTo(60, 9);
});

test('a weight that does not parse defensively counts as zero', () => {
  const bins: TickProfileBin[] = [{ low: '140.00', high: '160.00', total: '5', bid: 'oops', ask: '50' }];
  const rows = rowsOf(paint(makeProfile(bins)).ops);
  expect(rows).toHaveLength(1);
  expect(rows[0].style).toBe(ASK_COLOR);
});

// ---------------------------------------------------------------------------
// Slow-load profile loader: centred in the range band, clamped to the pane, only while flagged.
// ---------------------------------------------------------------------------
function paintSpinner(state: FixedRangeProfileState, vp: TestViewport = viewport, handles?: HandleEdges): Op[] {
  const ops: Op[] = [];
  drawFixedRangeProfileSpinner(recordInto(ops), renderArgsFor(vp).viewport, state, 0, handles);
  return ops;
}
const spinnerState = (patch: Partial<FixedRangeProfileState> = {}): FixedRangeProfileState => ({
  ...makeState(),
  loadingIndicator: true,
  ...patch,
});

const barsOf = (ops: Op[]) => ops.filter((op) => op.kind === 'fillRect');
const bandOps = () => paintSpinner(spinnerState({ range: { fromMs: RANGE_FROM, toMs: bars[8].time } }));

test('the loader is centred in the range band and the pane height', () => {
  // Band: anchor 73 (bar 3.5) to bar 8 centre (41 + 80 - 7 + 4 = 118) -> centre x 95.5; pane y centre 45 + 200.
  const ops = bandOps();
  const [centreLine] = linesOf(ops);
  expect(centreLine.minX).toBe(95.5);
  expect(centreLine.maxX).toBe(95.5);
  const rects = barsOf(ops);
  expect(rects).toHaveLength(LOADER_ROW_COUNT * 2);
  expect((Math.min(...rects.map((r) => r.minY)) + Math.max(...rects.map((r) => r.maxY))) / 2).toBe(245);
  expect(Math.max(...rects.map((r) => r.maxY)) - Math.min(...rects.map((r) => r.minY))).toBe(
    LOADER_ROW_COUNT * LOADER_ROW_HEIGHT + (LOADER_ROW_COUNT - 1) * LOADER_ROW_GAP,
  );
});

test('the loader draws a dashed centre line spanning the rows plus a margin', () => {
  const ops = bandOps();
  const [centreLine] = linesOf(ops);
  const rects = barsOf(ops);
  expect(centreLine.dashed).toBe(true);
  expect(centreLine.minY).toBe(Math.min(...rects.map((r) => r.minY)) - LOADER_LINE_MARGIN);
  expect(centreLine.maxY).toBe(Math.max(...rects.map((r) => r.maxY)) + LOADER_LINE_MARGIN);
});

test('red bid bars end at the centre and extend left, teal ask bars start at the centre and extend right', () => {
  const rects = barsOf(bandOps());
  const bids = rects.filter((r) => r.style === BID_COLOR);
  const asks = rects.filter((r) => r.style === ASK_COLOR);
  expect(bids).toHaveLength(LOADER_ROW_COUNT);
  expect(asks).toHaveLength(LOADER_ROW_COUNT);
  for (const bid of bids) {
    expect(bid.maxX).toBe(95.5);
    expect(bid.minX).toBeLessThan(95.5);
  }
  for (const ask of asks) {
    expect(ask.minX).toBe(95.5);
    expect(ask.maxX).toBeGreaterThan(95.5);
  }
});

test('the loader bar widths follow the animation helper at the given time', () => {
  const ops: Op[] = [];
  drawFixedRangeProfileSpinner(recordInto(ops), renderArgsFor(viewport).viewport, spinnerState(), 777);
  const rects = barsOf(ops);
  const widths = loaderRowWidths(777);
  widths.forEach((row, i) => {
    const bid = rects.find((r) => r.style === BID_COLOR && r.minY === rects[i * 2].minY)!;
    expect(bid.maxX - bid.minX).toBeCloseTo(row.bid, 6);
    const ask = rects.find((r) => r.style === ASK_COLOR && r.minY === rects[i * 2].minY)!;
    expect(ask.maxX - ask.minX).toBeCloseTo(row.ask, 6);
  });
});

const flatWidths = (t: number) => loaderRowWidths(t).flatMap((row) => [row.bid, row.ask]);
const sampleTimes = Array.from({ length: 400 }, (_, i) => i * 25);

const LOADER_CENTER_X = 100;
const LOADER_MIDDLE_Y = 50;
const LOADER_COLORS = { bid: BID_COLOR, ask: ASK_COLOR, line: palette.textBright };

test('drawLoader mirrors its rows around the given centre', () => {
  const ops: Op[] = [];
  drawLoader(recordInto(ops), LOADER_CENTER_X, LOADER_MIDDLE_Y, 0, LOADER_COLORS);
  const rects = barsOf(ops);
  expect(rects.filter((r) => r.style === BID_COLOR)).toHaveLength(LOADER_ROW_COUNT);
  expect(rects.filter((r) => r.style === ASK_COLOR)).toHaveLength(LOADER_ROW_COUNT);
  // Every bar touches the centre from its own side: bid ends there, ask starts there.
  for (const rect of rects) {
    expect(rect.style === BID_COLOR ? rect.maxX : rect.minX).toBe(LOADER_CENTER_X);
  }
  // Its dashed centre line runs through that x, too.
  const [centreLine] = linesOf(ops);
  expect(centreLine.minX).toBe(LOADER_CENTER_X);
});

test('loader row widths: five rows, within bounds, deterministic and animated', () => {
  for (const t of [0, 123, 500, 1234, 9999]) {
    const rows = loaderRowWidths(t);
    expect(rows).toHaveLength(LOADER_ROW_COUNT);
    for (const w of flatWidths(t)) {
      expect(w).toBeGreaterThanOrEqual(LOADER_MIN_WIDTH);
      expect(w).toBeLessThanOrEqual(LOADER_MAX_WIDTH);
    }
  }
  expect(loaderRowWidths(321)).toEqual(loaderRowWidths(321));
  expect(loaderRowWidths(0)).not.toEqual(loaderRowWidths(400));
});

test('loader bars ease between random targets without jumps', () => {
  // Smoothstep over a >=350 ms step crosses the 15 px span at <= ~0.065 px/ms, so 16 ms moves < 1.1 px.
  for (let t = 0; t < 10_000; t += 16) {
    const before = flatWidths(t);
    const after = flatWidths(t + 16);
    before.forEach((w, i) => expect(Math.abs(after[i] - w)).toBeLessThan(1.1));
  }
});

test('loader bars do not repeat on a fixed period', () => {
  for (const period of [1400, 700, 2800]) {
    const repeats = sampleTimes.filter((t) =>
      flatWidths(t).every((w, i) => Math.abs(w - flatWidths(t + period)[i]) < 0.01),
    );
    expect(repeats.length).toBeLessThan(sampleTimes.length / 20);
  }
});

test('loader bars use the whole width range rather than a regular wave', () => {
  const all = sampleTimes.flatMap(flatWidths);
  expect(Math.min(...all)).toBeLessThan(LOADER_MIN_WIDTH + 1);
  expect(Math.max(...all)).toBeGreaterThan(LOADER_MAX_WIDTH - 1);
});

test('loader bars move independently, not in lockstep or as a mirror image', () => {
  const series = Array.from({ length: LOADER_ROW_COUNT * 2 }, (_, bar) => sampleTimes.map((t) => flatWidths(t)[bar]));
  const peakTimes = series.map((widths) => sampleTimes[widths.indexOf(Math.max(...widths))]);
  expect(new Set(peakTimes).size).toBeGreaterThan(5);
  const samePattern = (a: number[], b: number[]) => a.every((w, i) => Math.abs(w - b[i]) < 1e-9);
  for (let i = 1; i < series.length; i += 1) {
    expect(samePattern(series[0], series[i])).toBe(false);
  }
  const mirroredRows = sampleTimes.filter((t) => loaderRowWidths(t).every((row) => Math.abs(row.bid - row.ask) < 0.01));
  expect(mirroredRows.length).toBeLessThan(sampleTimes.length / 20);
});

test('the loader uses the profile BID/ASK colours at full alpha', () => {
  const ops = bandOps();
  expect(new Set(barsOf(ops).map((r) => [r.style, r.alpha].join()))).toEqual(
    new Set([`${BID_COLOR},1`, `${ASK_COLOR},1`]),
  );
});

test('a band partly off screen centres the loader on its visible part', () => {
  const ops = paintSpinner(spinnerState({ range: { fromMs: bars[0].time, toMs: bars[9].time } }), {
    ...viewport,
    offset: 57,
  });
  // Band x: 41 + 4 - 57 = -12 .. 41 + 90 - 57 + 4 = 78 -> clamped to 41 .. 78.
  expect(linesOf(ops)[0].minX).toBe(59.5);
});

test('the loader paints nothing unless the requester flagged a slow load', () => {
  expect(paintSpinner(spinnerState({ loadingIndicator: false }))).toEqual([]);
  expect(paintSpinner(spinnerState({ range: null }))).toEqual([]);
  expect(paintSpinner(spinnerState({ previewing: true }))).toEqual([]);
});

// ---------------------------------------------------------------------------
// Loading wash: a translucent veil over the range band, under the spinner.
// ---------------------------------------------------------------------------
function paintWash(state: FixedRangeProfileState, vp: TestViewport = viewport, handles?: HandleEdges): Op[] {
  const ops: Op[] = [];
  drawFixedRangeProfileLoadingWash(recordInto(ops), renderArgsFor(vp).viewport, state, handles);
  return ops;
}

test('the loading wash covers exactly the range band over the full pane height', () => {
  // Band x: anchor 73 .. bar 8 centre 118; pane y 45 .. 445.
  const ops = paintWash(spinnerState({ range: { fromMs: RANGE_FROM, toMs: bars[8].time } }));
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ kind: 'fillRect', minX: 73, maxX: 118, minY: 45, maxY: 445 });
});

test('the loading wash is the raised palette colour at a partial alpha so candles stay visible', () => {
  const ops = paintWash(spinnerState({ range: { fromMs: RANGE_FROM, toMs: bars[8].time } }));
  expect([ops[0].style, ops[0].alpha]).toEqual([palette.raised, LOADING_WASH_ALPHA]);
  expect(LOADING_WASH_ALPHA).toBeGreaterThan(0);
  expect(LOADING_WASH_ALPHA).toBeLessThan(1);
});

test('a band partly off screen gets a wash clamped to the pane', () => {
  const ops = paintWash(spinnerState({ range: { fromMs: bars[0].time, toMs: bars[9].time } }), {
    ...viewport,
    offset: 57,
  });
  // Band x: -12 .. 78 -> clamped to 41 .. 78.
  expect(ops[0]).toMatchObject({ minX: 41, maxX: 78 });
});

test('the loading wash spans the handle band even when the requested end is clipped short of the right handle', () => {
  // The request end is clipped to bar 8 (x 118) but the right handle sits on a future slot at x 150.
  const handles = { fromX: ANCHOR_X, toX: 150 };
  const state = spinnerState({ range: { fromMs: RANGE_FROM, toMs: bars[8].time } });
  const ops = paintWash(state, viewport, handles);
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ kind: 'fillRect', minX: 73, maxX: 150, minY: 45, maxY: 445 });
});

test('the loader is centred on the handle band, and both clamp to the pane', () => {
  const state = spinnerState({ range: { fromMs: RANGE_FROM, toMs: bars[8].time } });
  expect(linesOf(paintSpinner(state, viewport, { fromX: ANCHOR_X, toX: 150 }))[0].minX).toBe(111.5);
  // Right handle beyond the pane's right edge (641): the band clamps to it.
  const wide = { fromX: ANCHOR_X, toX: 900 };
  expect(paintWash(state, viewport, wide)[0]).toMatchObject({ minX: 73, maxX: 641 });
  expect(linesOf(paintSpinner(state, viewport, wide))[0].minX).toBe(357);
});

test('the loading wash paints nothing unless a slow load is flagged on a visible, unpreviewed range', () => {
  expect(paintWash(spinnerState({ loadingIndicator: false }))).toEqual([]);
  expect(paintWash(spinnerState({ range: null }))).toEqual([]);
  expect(paintWash(spinnerState({ previewing: true }))).toEqual([]);
  // Entirely right of the pane: band 641+ is off screen.
  expect(paintWash(spinnerState(), { ...viewport, offset: -1000 })).toEqual([]);
  // Entirely left of the pane.
  expect(paintWash(spinnerState(), { ...viewport, offset: 1000 })).toEqual([]);
});
