import { layoutLabelCenters } from '../src/features/chart/engine/labelLayout';
import { test, expect } from '@playwright/test';
import type { OverlayRenderer as OverlayPlugin } from '../src/features/chart/engine/overlayTypes';
import { buildChartPlugins, type ChartOverlayState } from '../src/features/chart/engine/overlays';

/**
 * Paint-order (z-index) and row-inset regression for the chart overlays.
 * Everything is drawn on canvas, so the z-order IS the paint order: the chart
 * renders `ui`-layer plugins in REGISTRATION order, and features/chart/engine/overlays.ts
 * encodes the contract — every dotted level/reference line (bid/ask, entry,
 * SL, TP) and risk-zone fill paints UNDER every row label (chips, handles, qty
 * and axis tags). The row panels (✕ chip / pill / handles) additionally keep a
 * left-edge inset (ROW_INSET) so they never hug the chart border.
 *
 * The bug this locks down: the ASK line used to paint over the staged "Buy"
 * chip (a dashed line striking through the label) because the bid/ask overlay
 * was registered after the row overlays.
 *
 * Method: a recording 2D-context captures every fill/stroke/fillText with its
 * color, dash flag, alpha and y-extent; the assertions run on the recorded op
 * sequence, exactly what the pixels would show.
 */

type OpKind = 'stroke' | 'fill' | 'fillText' | 'fillRect';
interface Op {
  plugin: string;
  kind: OpKind;
  style: string;
  alpha: number;
  dashed: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  text?: string;
}

/** Level/reference line ops (dotted strokes + 12% risk-zone fills). */
function isLineOp(op: Op) {
  return (op.kind === 'stroke' && op.dashed) || (op.kind === 'fillRect' && op.alpha < 1);
}

/** Row-label ops (chips/handles/tags: path fills, texts, chip borders, ✕ arms). */
function isLabelOp(op: Op) {
  return (
    op.kind === 'fillText' ||
    op.kind === 'fill' ||
    (op.kind === 'stroke' && !op.dashed) ||
    (op.kind === 'fillRect' && op.alpha >= 1)
  );
}

function createRecordingCtx(ops: Op[], plugin: string): CanvasRenderingContext2D {
  let pathXs: number[] = [];
  let pathYs: number[] = [];
  let dashed = false;
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
    clip() {},
    beginPath() {
      pathXs = [];
      pathYs = [];
    },
    rect(px: number, py: number, w: number, h: number) {
      pathXs.push(px, px + w);
      pathYs.push(py, py + h);
    },
    moveTo(px: number, py: number) {
      pathXs.push(px);
      pathYs.push(py);
    },
    lineTo(px: number, py: number) {
      pathXs.push(px);
      pathYs.push(py);
    },
    quadraticCurveTo(cx: number, cy: number, px: number, py: number) {
      pathXs.push(cx, px);
      pathYs.push(cy, py);
    },
    arc(cx: number, cy: number, r: number) {
      pathXs.push(cx - r, cx + r);
      pathYs.push(cy - r, cy + r);
    },
    setLineDash(dash: number[]) {
      dashed = dash.length > 0;
    },
    measureText(text: string) {
      return { width: text.length * 7 };
    },
    stroke() {
      ops.push({ plugin, kind: 'stroke', style: ctx.strokeStyle, alpha: ctx.globalAlpha, dashed, ...extent() });
    },
    fill() {
      ops.push({ plugin, kind: 'fill', style: ctx.fillStyle, alpha: ctx.globalAlpha, dashed: false, ...extent() });
    },
    fillRect(px: number, py: number, w: number, h: number) {
      ops.push({
        plugin,
        kind: 'fillRect',
        style: ctx.fillStyle,
        alpha: ctx.globalAlpha,
        dashed: false,
        minX: px,
        maxX: px + w,
        minY: py,
        maxY: py + h,
      });
    },
    fillText(text: string, px: number, py: number) {
      ops.push({
        plugin,
        kind: 'fillText',
        style: ctx.fillStyle,
        alpha: ctx.globalAlpha,
        dashed: false,
        minX: px,
        maxX: px + 30,
        minY: py - 8,
        maxY: py + 8,
        text,
      });
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

// 4px per price unit — every row below lands within y 242–248, the maximal
// collision stress (zoomed-out chart with tight SL/TP).
const viewport = {
  chartRect: { x: 41, y: 45, width: 600, height: 400 },
  priceRange: { min: 100, max: 200 },
  barSpacing: 2,
  barWidth: 8,
  offset: -50,
  visibleRange: { from: 5, to: 20 },
  scaleMode: 'linear',
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
const renderArgs = {
  viewport: {
    ...viewport,
    priceToY: viewport.priceToY.bind(viewport),
    yToPrice: viewport.yToPrice.bind(viewport),
    timeToX: viewport.timeToX.bind(viewport),
  },
} as Parameters<OverlayPlugin['render']>[1];

function collidingStates(): ChartOverlayState {
  return {
    fixedRangeProfile: { range: null, hit: {} },
    // ASK = the staged buy entry (the reported artifact: ASK line over "Buy").
    priceLines: { ask: 150, bid: 149.9, digits: 2, hit: {} },
    staged: {
      order: { side: 'buy', entry: 150, stopLoss: 149.5, takeProfit: 150.5, volume: '1', orderKindLabel: 'Market' },
      digits: 2,
      hit: {},
    },
    positions: {
      positions: [
        {
          id: 'pos-1',
          side: 'sell',
          volume: '1',
          entry: 149.9,
          stopLoss: 150.4,
          takeProfit: 149.4,
          pnl: '+$1.04',
          slMoney: '-$6.63',
          tpMoney: '+$8.00',
        },
      ],
      orders: [
        { id: 'ord-1', side: 'buy', price: 150.1, quantity: '2', label: 'LIMIT', stopLoss: 149.6, takeProfit: 150.6 },
      ],
      digits: 2,
      drag: null,
      hit: {},
    },
  };
}

function renderAll(ops: Op[], filter: (id: string) => boolean) {
  for (const entry of buildChartPlugins(collidingStates())) {
    const overlay = entry.plugin as unknown as OverlayPlugin;
    if (!filter(overlay.descriptor.id)) {
      continue;
    }
    overlay.render(createRecordingCtx(ops, overlay.descriptor.id), renderArgs);
  }
}

test('chart plugin registration is the overlay z-index contract', () => {
  const ids = buildChartPlugins(collidingStates()).map(
    (entry) => (entry.plugin as unknown as OverlayPlugin).descriptor.id,
  );
  // ALL lines passes first, then ALL labels passes (see features/chart/engine/overlays.ts).
  expect(ids).toEqual([
    'fixed-range-profile',
    'price-lines-lines',
    'position-overlay-lines',
    'staged-order-lines',
    'price-lines-labels',
    'position-overlay-labels',
    'staged-order-labels',
    'trading-labels',
  ]);
});

test('every level/reference line paints under every row label', () => {
  const ops: Op[] = [];
  renderAll(ops, (id) => id !== 'fixed-range-profile');
  const lineOps = ops.filter(isLineOp);
  const labelOps = ops.filter(isLabelOp);
  // The collision scenario must actually exercise both classes.
  expect(lineOps.length).toBeGreaterThan(0);
  expect(labelOps.length).toBeGreaterThan(0);
  const lastLineIndex = ops.map(isLineOp).lastIndexOf(true);
  const firstLabelIndex = ops.map(isLabelOp).indexOf(true);
  // A dashed line (e.g. the ASK line on the staged "Buy" row) may never paint
  // after — i.e. on top of — a label at its price.
  expect(lastLineIndex).toBeLessThan(firstLabelIndex);
});

test('passes stay pure: the lines pass emits no labels, the labels pass no lines', () => {
  const linePassOps: Op[] = [];
  renderAll(linePassOps, (id) => id.endsWith('-lines'));
  expect(linePassOps.some(isLabelOp)).toBe(false);
  expect(linePassOps.some(isLineOp)).toBe(true);

  const labelPassOps: Op[] = [];
  renderAll(labelPassOps, (id) => id.endsWith('-labels'));
  expect(labelPassOps.some(isLineOp)).toBe(false);
  expect(labelPassOps.some(isLabelOp)).toBe(true);
});

test('row panels keep their inset from the chart left edge in both overlays', () => {
  const ops: Op[] = [];
  renderAll(ops, (id) => id.endsWith('-labels'));
  // Left-column row widgets only (chips/handles/tags at the rows), not the
  // right-axis tags. Floor 20px: catches any return to the old x+12/x+28 hug
  // (chip edge at 2px) while staying independent of the exact ROW_INSET tune.
  const rowOps = ops.filter((op) => isLabelOp(op) && op.minX < viewport.chartRect.x + 200);
  expect(rowOps.length).toBeGreaterThan(0);
  for (const op of rowOps) {
    expect(op.minX).toBeGreaterThanOrEqual(viewport.chartRect.x + 20);
  }
});

test('colliding trading and staged rows spread apart without moving their price lines', () => {
  const state = collidingStates();
  const ops: Op[] = [];
  for (const { plugin } of buildChartPlugins(state)) {
    plugin.render(createRecordingCtx(ops, plugin.descriptor.id), renderArgs);
  }
  const rows = [...(state.positions.hit.labels ?? []), ...(state.staged.hit.labels ?? [])].sort((a, b) => a.y - b.y);
  expect(rows).toHaveLength(9);
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].y - (rows[i - 1].y + rows[i - 1].h)).toBeGreaterThanOrEqual(12);
  }
  expect(state.positions.hit.slLines?.find((line) => line.id === 'pos-1')?.y).toBeCloseTo(viewport.priceToY(150.4));
  expect(state.staged.hit.entryLineY).toBeCloseTo(viewport.priceToY(150));
  const close = state.positions.hit.posCloses!.find((chip) => chip.id === 'pos-1')!;
  const entry = rows.find((row) => row.id === 'pos-1' && row.level === 'entry')!;
  expect(close.y).toBe(entry.y + entry.h / 2);
  const gutterStrokes = ops.filter((op) => op.kind === 'stroke' && !op.dashed && op.maxX <= viewport.chartRect.x + 24);
  expect(gutterStrokes).toHaveLength(0);
});

test('isolated labels retain their exact price coordinates', () => {
  expect(layoutLabelCenters([100, 150, 250], 45, 445)).toEqual([100, 150, 250]);
});

test('clusters near either pane edge keep their buttons and tips visible', () => {
  for (const desired of [
    [45, 46, 47],
    [443, 444, 445],
  ]) {
    const centres = layoutLabelCenters(desired, 45, 445);
    expect(centres[0]).toBeGreaterThanOrEqual(60);
    expect(centres.at(-1)).toBeLessThanOrEqual(430);
    expect(centres[1] - centres[0]).toBe(32);
    expect(centres[2] - centres[1]).toBe(32);
  }
});
