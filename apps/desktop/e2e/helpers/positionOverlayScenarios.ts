import { createPositionOverlay } from '../../src/features/chart/engine/trading/positionOverlay';
import type { PositionOverlayState } from '../../src/features/chart/engine/trading/positionOverlayTypes';
import { createRecordingCtx, createTestViewport, renderArgsFor, type PaintOp } from './overlayHarness';

/**
 * Fixtures and the recording renderer for the position overlay geometry spec.
 * Price scale: y(price) = 45 + (200 - price) * 4, pane y 45..445.
 */

export const viewport = createTestViewport({ offset: 0, visibleRange: { from: 0, to: 10 }, scaleMode: 'linear' });

type Frame = Omit<PositionOverlayState, 'hit'>;

const emptyFrame: Frame = { positions: [], orders: [], digits: 2, drag: null };

const buyPosition = {
  id: 'pos-buy',
  side: 'buy' as const,
  volume: '1',
  entry: 150,
  stopLoss: 145,
  takeProfit: 160,
  pnl: '+1.04 USD',
  slMoney: '−20.00 USD',
  tpMoney: '+40.00 USD',
};

const limitOrder = {
  id: 'ord-limit',
  side: 'buy' as const,
  price: 140,
  quantity: '2',
  label: 'LIMIT',
  stopLoss: 135,
  takeProfit: 150,
  slMoney: '−10.00 USD',
  tpMoney: '+20.00 USD',
};

export const scenarios: Record<string, Frame> = {
  'buy position with SL and TP': { ...emptyFrame, positions: [buyPosition] },
  'sell position with only SL': {
    ...emptyFrame,
    positions: [
      { id: 'pos-sell', side: 'sell', volume: '3', entry: 150, stopLoss: 155, pnl: '−6.63 USD', slMoney: '−15.00 USD' },
    ],
  },
  'partial close available and no P&L yet': {
    ...emptyFrame,
    positions: [
      { id: 'pos-partial', side: 'buy', volume: '1', entry: 150, pnl: '+2.00 USD', partialClose: true },
      { id: 'pos-fresh', side: 'sell', volume: '1', entry: 130 },
    ],
  },
  'pending limit order with SL and TP': { ...emptyFrame, orders: [limitOrder] },
  'pending stop order without exits': {
    ...emptyFrame,
    orders: [{ id: 'ord-stop', side: 'sell', price: 160, quantity: '1', label: 'STOP LIMIT' }],
  },
  'SL drag preview with money on a position': {
    ...emptyFrame,
    positions: [buyPosition],
    drag: { kind: 'sl', id: 'pos-buy', price: 143, money: '−28.00 USD' },
  },
  'TP drag with money on an order': {
    ...emptyFrame,
    orders: [limitOrder],
    drag: { kind: 'tp', id: 'order:ord-limit', price: 152, money: '+24.00 USD' },
  },
  'order line drag with exit preview': {
    ...emptyFrame,
    orders: [limitOrder],
    drag: { kind: 'order', id: 'ord-limit', price: 141, exitPreview: true, stopLoss: 136, takeProfit: 151 },
  },
  'entry outside the pane while exits are inside': {
    ...emptyFrame,
    positions: [{ id: 'pos-low', side: 'buy', volume: '1', entry: 90, takeProfit: 150, pnl: '+9.00 USD' }],
  },
};

export type RenderedOverlay = { ops: PaintOp[]; hit: PositionOverlayState['hit'] };

export function emptyState(frame: Frame): PositionOverlayState {
  return { ...frame, hit: {} };
}

/** Renders every frame through one renderer (it keeps the P&L column widths) and returns the last frame. */
export function renderFrames(pass: 'lines' | 'labels', frames: Frame[], chartWidth = 600): RenderedOverlay {
  const state = emptyState(frames[0]);
  const renderer = createPositionOverlay(state, pass);
  const view = renderArgsFor({ ...viewport, chartRect: { ...viewport.chartRect, width: chartWidth } });
  let ops: PaintOp[] = [];
  for (const frame of frames) {
    Object.assign(state, frame);
    ops = [];
    renderer.render(
      createRecordingCtx((op) => ops.push(op), { recordClip: true }),
      view,
    );
  }
  return { ops, hit: state.hit };
}

export function describeOp(op: PaintOp): string {
  const extent = `[${op.minX},${op.minY},${op.maxX},${op.maxY}]`;
  const text = op.kind === 'fillText' ? ` ${JSON.stringify(op.text)}@${op.x},${op.y} ${op.font}` : '';
  const style = op.kind === 'clip' ? '' : ` ${op.style}`;
  return `${op.kind}${style} a${op.alpha} ${extent}${text}`;
}

export function describeOps(ops: PaintOp[]): string {
  return ops.map(describeOp).join('\n');
}

/** The hit state without the pane-bound inverse function (checked separately). */
export function hitData(hit: PositionOverlayState['hit']): Record<string, unknown> {
  const data: Record<string, unknown> = { ...hit };
  delete data.toPrice;
  return data;
}
