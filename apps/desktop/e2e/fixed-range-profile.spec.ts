import { test, expect } from '@playwright/test';
import type { OverlayRenderer as OverlayPlugin } from '../src/features/chart/engine/overlayTypes';
import {
  createFixedRangeProfileOverlay,
  type FixedRangeProfileState,
} from '../src/features/chart/engine/fixedRangeProfileOverlay';
import type { ProfileResult, TickProfileBin } from '../src/shared/bridge/types';

/**
 * Geometry + paint-order regression for the fixed-range volume-profile overlay.
 * Pure Node spec (no page): a recording 2D-context captures every clip,
 * fillRect, stroke and fillText with its color, alpha, dash and exact extents,
 * so the assertions run on the recorded op sequence — exactly what the pixels
 * would show.
 *
 * Contract locked down here (see fixedRangeProfileOverlay.ts):
 *  - time→x anchor = the public viewport mapping (bar center): chartRect.x + i*(barWidth+barSpacing) - offset + barWidth/2,
 *    with i located by binary search over bar times (interpolate inside, clamp outside);
 *  - mirrored rows around the anchor (BID left / ASK right), ONE common weight denominator;
 *  - POC row alpha 1 vs 0.75 for every other row, whole paint clipped to chartRect;
 *  - level lines from the range start (anchorX) to the chartRect's right edge, painted AFTER the rows — POC solid, VAH/VAL dashed [4,3]; NO text labels;
 *  - null range / missing profile / empty bins → zero paint ops and an empty `hit`.
 */

type OpKind = 'clip' | 'fillRect' | 'stroke' | 'fillText';

interface Op {
  kind: OpKind;
  style: string;
  alpha: number;
  dashed: boolean;
  dash: number[];
  font: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Exact fillText anchor (min/max above mirror it for extent-style checks). */
  x?: number;
  y?: number;
  text?: string;
}

/** Recording ctx — adapted from overlay-z-order.spec.ts, plus clip/dash and exact text anchors. */
function createRecordingCtx(ops: Op[]): CanvasRenderingContext2D {
  let pathXs: number[] = [];
  let pathYs: number[] = [];
  let dash: number[] = [];
  const extent = () => ({
    minX: Math.min(...pathXs),
    maxX: Math.max(...pathXs),
    minY: Math.min(...pathYs),
    maxY: Math.max(...pathYs),
  });
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save() {},
    restore() {},
    closePath() {},
    beginPath() {
      pathXs = [];
      pathYs = [];
    },
    rect(px: number, py: number, w: number, h: number) {
      pathXs.push(px, px + w);
      pathYs.push(py, py + h);
    },
    clip() {
      ops.push({ kind: 'clip', style: '', alpha: ctx.globalAlpha, dashed: false, dash: [], font: '', ...extent() });
    },
    moveTo(px: number, py: number) {
      pathXs.push(px);
      pathYs.push(py);
    },
    lineTo(px: number, py: number) {
      pathXs.push(px);
      pathYs.push(py);
    },
    setLineDash(d: number[]) {
      dash = [...d];
    },
    measureText(text: string) {
      return { width: text.length * 7 };
    },
    stroke() {
      ops.push({
        kind: 'stroke',
        style: ctx.strokeStyle,
        alpha: ctx.globalAlpha,
        dashed: dash.length > 0,
        dash: [...dash],
        font: ctx.font,
        ...extent(),
      });
    },
    fillRect(px: number, py: number, w: number, h: number) {
      ops.push({
        kind: 'fillRect',
        style: ctx.fillStyle,
        alpha: ctx.globalAlpha,
        dashed: false,
        dash: [],
        font: ctx.font,
        minX: px,
        maxX: px + w,
        minY: py,
        maxY: py + h,
      });
    },
    fillText(text: string, px: number, py: number) {
      ops.push({
        kind: 'fillText',
        style: ctx.fillStyle,
        alpha: ctx.globalAlpha,
        dashed: false,
        dash: [],
        font: ctx.font,
        minX: px,
        maxX: px,
        minY: py,
        maxY: py,
        x: px,
        y: py,
        text,
      });
    },
    fill() {
      /* not used by this overlay */
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

// ---------------------------------------------------------------------------
// Fixture: 10 bars 60s apart, linear price scale 100–200 → priceY(p) = 45 + (200-p)*4.
// ---------------------------------------------------------------------------
const chartRect = { x: 41, y: 45, width: 600, height: 400 };
const viewport = {
  chartRect,
  priceRange: { min: 100, max: 200 },
  barSpacing: 2,
  barWidth: 8,
  offset: 7,
  visibleRange: { from: 0, to: 9 },
  scaleMode: 'regular',
  logScale: false,
  priceToY(price: number): number {
    return (
      this.chartRect.y +
      ((this.priceRange.max - price) / (this.priceRange.max - this.priceRange.min)) * this.chartRect.height
    );
  },
  yToPrice(y: number): number {
    return (
      this.priceRange.max -
      ((y - this.chartRect.y) / this.chartRect.height) * (this.priceRange.max - this.priceRange.min)
    );
  },
  timeToX(timeMs: number): number {
    const index = Math.max(0, Math.min(9, (timeMs - 1_000) / 60_000));
    return this.chartRect.x + index * (this.barWidth + this.barSpacing) - this.offset + this.barWidth / 2;
  },
};
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
const DEFAULT_BINS: TickProfileBin[] = [
  { low: '140.00', high: '150.00', total: '10', bid: '6', ask: '40' },
  { low: '150.00', high: '160.00', total: '10', bid: '12', ask: '12' },
  { low: '160.00', high: '170.00', total: '10', bid: '3', ask: '50' },
];

function makeProfile(bins: TickProfileBin[]): ProfileResult {
  return {
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

function makeState(profile?: ProfileResult): FixedRangeProfileState {
  return { range: { fromMs: RANGE_FROM, toMs: RANGE_FROM + 5 * BAR_INTERVAL }, profile, hit: {} };
}

function paint(
  profile?: ProfileResult,
  vp: typeof viewport = viewport,
  range?: FixedRangeProfileState['range'],
): { ops: Op[]; state: FixedRangeProfileState } {
  const state = makeState(profile);
  if (range !== undefined) {
    state.range = range;
  }
  const args: Parameters<OverlayPlugin['render']>[1] = {
    viewport: {
      ...vp,
      priceToY: vp.priceToY.bind(vp),
      yToPrice: vp.yToPrice.bind(vp),
      timeToX: vp.timeToX.bind(vp),
    },
  };
  const ops: Op[] = [];
  createFixedRangeProfileOverlay(state).render(createRecordingCtx(ops), args);
  return { ops, state };
}

const rowsOf = (ops: Op[]) => ops.filter((op) => op.kind === 'fillRect');
const linesOf = (ops: Op[]) => ops.filter((op) => op.kind === 'stroke');
const labelsOf = (ops: Op[]) => ops.filter((op) => op.kind === 'fillText');

// ---------------------------------------------------------------------------
// Descriptor + (a) mirrored geometry + verified time→x anchor.
// ---------------------------------------------------------------------------
test('descriptor is the overlay-layer fixed-range profile plugin', () => {
  const plugin = createFixedRangeProfileOverlay(makeState(makeProfile(DEFAULT_BINS)));
  expect(plugin.descriptor).toEqual({
    id: 'fixed-range-profile',
    name: 'Fixed Range Volume Profile',
    layer: 'overlay',
  });
});

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
    const args = { viewport, data: bars, theme: {} } as unknown as Parameters<OverlayPlugin['render']>[1];
    createFixedRangeProfileOverlay(state).render(createRecordingCtx(ops), args);
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
