import type { OverlayRenderer } from './overlayTypes';
import type { RiskSide } from '../../../shared/bridge/types';
import { riskRewardRatio } from '../../order-ticket/domain/ticketRules';
import {
  STAGED_COLORS,
  tagPath,
  drawHandle,
  drawCancelChip,
  type StagedHitRect,
  type OverlayPass,
  CANCEL_CHIP_X,
  HANDLE_X,
} from './stagedOrderOverlay';
import { palette } from '../../../shared/theme/palette';

/**
 * OUR trading overlay — position entry/SL/TP lines and pending-order lines for
 * the ACTIVE symbol, drawn as a `ui`-layer overlay on the SAME mechanism
 * contract as stagedOrderOverlay.ts (geometry recorded per frame in state.hit;
 * all input through App's capture-phase handlers).
 *
 * VISUAL IDENTITY (owner): after an order fills the overlay must look EXACTLY
 * like the staged widget the user composed it with — same primitives imported
 * from stagedOrderOverlay (native dashed price lines, side pill, pointed "⋮⋮ | qty | kind"
 * tag, "⋮⋮ SL/TP" handles, 12% risk zones, ✕ chips) — the ONLY addition is the
 * signed P&L pill on the position entry row. Native price lines provide the
 * right-axis level labels.
 *
 * This REPLACES the library's built-in trading overlay (PositionRenderer /
 * OrderRenderer + axis badges): App never feeds chart.setPositions() /
 * chart.setOrders(), so the library paints nothing and its drag hit-testing
 * falls through to pan.
 *
 * COORDINATE FRAME (see stagedOrderOverlay.ts for the full bug class): every
 * geometry and input share chart-host CSS pixels, including on Retina displays.
 *
 * DRAG PARITY with the library's TradingDragHandler: grab tolerance ±8px on y
 * (TRADING_GRAB), 3px vertical threshold before a drag "starts"
 * (LINE_DRAG_THRESHOLD), dispatch on release — for a pending order's PRICE
 * line and a position's SL/TP lines. Entry lines are display-only.
 *
 * ✕ CHIPS: entry-row ✕ closes the position / cancels the pending order (the
 * library never had ✕ affordances). SL/TP rows carry NO ✕: the staged ✕
 * unsets a DRAFT level, but the modify wire only accepts positive prices
 * (null/absent = unchanged) — there is no safe "clear the stop" path, and a
 * one-click removal of a protective SL must not exist.
 */

export interface PositionLine {
  id: string;
  side: RiskSide;
  /** Display string for the label, e.g. "1" (Number-normalized like the library). */
  volume: string;
  entry: number;
  stopLoss?: number;
  takeProfit?: number;
  /** Signed money P&L in the ACCOUNT currency (SL/TP money format),
   *  e.g. "+$1.04" / "-$6.63". */
  pnl?: string;
  /** Third segment of the entry tag ("⋮⋮  |  1  |  Market") — the kind shown
   *  while staging; a filled position carries no order type, so App may leave
   *  it unset and the painter falls back to "Market". */
  kindLabel?: string;
  /** Signed money at the exits (account currency) — staged-widget label rule:
   *  SET levels only; undefined keeps the plain "SL"/"TP" handle. */
  slMoney?: string;
  tpMoney?: string;
}

export interface OrderLine {
  id: string;
  side: RiskSide;
  price: number;
  /** Normalized volume string, e.g. "1" (never the raw "1.00000000"). */
  quantity: string;
  /** "LIMIT" | "STOP" | "STOP LIMIT". */
  label: string;
  stopLoss?: number;
  takeProfit?: number;
  /** Signed money at the exits (account currency) — same rule as positions:
   *  set levels only, undefined keeps the plain "SL"/"TP" handle. */
  slMoney?: string;
  tpMoney?: string;
}

/** Which painted line a live drag is attached to; `id` disambiguates. `money`
 *  is the live money label for the dragged level (recomputed per move). */
export interface PositionDrag {
  kind: 'order' | 'sl' | 'tp';
  id: string;
  price: number;
  money?: string;
  /** Effective exit prices while an order-line drag preview is active. */
  exitPreview?: boolean;
  /** These exit prices include a Shift move and must survive a plain re-drag. */
  shiftedExits?: boolean;
  stopLoss?: number;
  takeProfit?: number;
}

export interface PositionLineHit {
  id: string;
  y: number;
}
export interface PositionHandleHit extends StagedHitRect {
  id: string;
}
/** ✕ chip hit geometry (the staged drawCancelChip circumscribing circle, r = 10)
 *  recorded per frame for App's capture handlers. */
export interface CancelChipHit {
  id: string;
  x: number;
  y: number;
  r: number;
}

export interface PositionOverlayState {
  /** Replace-style sync from the portfolio snapshot (active symbol only). */
  positions: PositionLine[];
  orders: OrderLine[];
  /** Instrument precision mirrored from the active symbol. */
  digits: number;
  /** Money-label basis (account currency) — lets App recompute the dragged
   *  level's money label live; the painter only formats. */
  money?: { contractSize: number; currency: string };
  /** Live drag preview; cleared by the next sync / drag end. */
  drag: PositionDrag | null;
  /** Fresh geometry every paint; read by the host pointer handlers. */
  hit: {
    chartRect?: { x: number; y: number; width: number; height: number };
    /** Viewport px → price inverse transform from the last paint (UNCLAMPED,
     *  like the library's yToPrice — a drag may extrapolate past the range). */
    toPrice?: (y: number) => number;
    /** Grabbable lines in chart-frame y: order price first, then SL, then TP
     *  — the exact order TradingDragHandler hit-tested. */
    orderLines?: PositionLineHit[];
    slLines?: PositionLineHit[];
    tpLines?: PositionLineHit[];
    /** Floating SL/TP handles for live positions and orders without a level. */
    slHandles?: PositionHandleHit[];
    tpHandles?: PositionHandleHit[];
    /** ✕ chips: position entry (close) + order price (cancel). Click targets,
     *  dispatched through the same requestClosePosition/requestCancelOrder
     *  flows the portfolio rows use. */
    posCloses?: CancelChipHit[];
    orderCancels?: CancelChipHit[];
    /** ✕ chips on the SL/TP rows — REMOVE that level (modify with the "0"
     *  sentinel). Ids follow the line convention (`order:` prefix for orders). */
    slClears?: CancelChipHit[];
    tpClears?: CancelChipHit[];
  };
}

/** Library TradingDragHandler grab tolerance: |y − lineY| ≤ 8 claims the drag. */
export const TRADING_GRAB = 8;
/** Library dragThreshold: vertical px before a claimed grab starts moving. */
export const LINE_DRAG_THRESHOLD = 3;

const titleCase = (label: string) => label.toLowerCase().replace(/(^|\s)\S/g, (char) => char.toUpperCase());

export function createPositionOverlay(state: PositionOverlayState, pass: OverlayPass): OverlayRenderer {
  // Widest P&L box seen per position id: the live value reflows every tick,
  // so the pill keeps the largest width it has had instead of resizing.
  // (The `lines` pass never writes it; the two renderers are independent.)
  const pnlBoxWidths = new Map<string, number>();
  return {
    // `ui` layer: row widgets render over the chart. Two-pass z-order (`lines`
    // before `labels`, features/chart/engine/overlays.ts) keeps risk zones beneath row labels;
    // native price lines and their axis labels render below this primitive.
    descriptor: { id: `mt5-position-overlay-${pass}`, name: `Positions & Orders (${pass})`, layer: 'ui' },
    render(ctx, { viewport }) {
      const { x, y, width, height } = viewport.chartRect;
      const drawLines = pass === 'lines';
      const drawLabels = pass === 'labels';
      const { min, max } = viewport.priceRange;
      const hit: PositionOverlayState['hit'] = {};

      if (width <= 0 || height <= 0 || !(max > min)) {
        state.hit = hit;
        return;
      }
      const toY = viewport.priceToY;
      const toPrice = viewport.yToPrice;
      hit.chartRect = { x, y, width, height };
      hit.toPrice = toPrice;
      hit.orderLines = [];
      hit.slLines = [];
      hit.tpLines = [];
      hit.slHandles = [];
      hit.tpHandles = [];
      hit.posCloses = [];
      hit.orderCancels = [];
      hit.slClears = [];
      hit.tpClears = [];

      const inBand = (lineY: number) => lineY >= y && lineY <= y + height;

      // Live drag preview: the dragged line renders at the preview price.
      const drag = state.drag;
      const preview = (kind: 'order' | 'sl' | 'tp', id: string, base: number | undefined) =>
        drag && drag.kind === kind && drag.id === id ? drag.price : base;

      // ── Staged-widget row primitives (verbatim geometry from
      //    stagedOrderOverlay — the row after the fill must not drift).
      const qtyTag = (cx: number, lineY: number, text: string, color: string): number => {
        ctx.font = '600 12px system-ui, sans-serif';
        const tagW = ctx.measureText(text).width + 16;
        tagPath(ctx, cx, lineY - 10, tagW + 8, 20, 7);
        ctx.fillStyle = STAGED_COLORS.surface;
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = STAGED_COLORS.text;
        ctx.fillText(text, cx + 8, lineY + 0.5);
        return cx + tagW + 6;
      };
      // THE one addition over the staged row: signed P&L — drawn in the SAME
      // handle style as the SL/TP boxes (drawHandle), profit/loss colored.
      // (The live position row's boxes are composed inline below.)
      // Staged SL/TP handle ("⋮⋮  SL -$50" / plain "⋮⋮  SL" when no money);
      // the tip always points toward the ENTRY line (inward).
      const exitHandle = (lineY: number, kind: 'sl' | 'tp', money: string | undefined, entryY: number) =>
        drawHandle(
          ctx,
          x + HANDLE_X,
          lineY,
          `${kind === 'sl' ? 'SL' : 'TP'}${money ? ` ${money}` : ''}`,
          kind === 'sl' ? STAGED_COLORS.sl : STAGED_COLORS.tp,
          lineY < entryY,
        );
      const floatingExitY = (entryY: number, kind: 'sl' | 'tp', side: RiskSide) => {
        const aboveEntry = kind === 'sl' ? side === 'sell' : side === 'buy';
        return entryY + (aboveEntry ? -1 : 1) * 32;
      };
      // 12% risk zone between the entry row and an exit (staged palette).
      const zone = (entryY: number, levelY: number, color: string) => {
        if (levelY < y - height || levelY > y + height * 2) {
          return;
        }
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = color;
        ctx.fillRect(x, Math.min(entryY, levelY), width, Math.abs(levelY - entryY));
        ctx.globalAlpha = 1;
      };

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      // ── Positions: staged entry row (+ the P&L pill) and staged SL/TP rows.
      for (const pos of state.positions) {
        const sideColor = pos.side === 'buy' ? STAGED_COLORS.buy : STAGED_COLORS.sell;
        const entryY = toY(pos.entry);
        const sl = preview('sl', pos.id, pos.stopLoss);
        const tp = preview('tp', pos.id, pos.takeProfit);
        if (drawLines) {
          if (sl !== undefined) {
            zone(entryY, toY(sl), palette.sellSoft);
          }
          if (tp !== undefined) {
            zone(entryY, toY(tp), palette.accent);
          }
        }
        if (inBand(entryY)) {
          if (drawLabels) {
            // The ✕ echoes the P&L state — red losing, green profiting — not the
            // side: a red sell ✕ beside a green P&L read as a contradiction.
            // Before the first P&L arrives it falls back to the side colour.
            let pnlColor = sideColor;
            if (pos.pnl !== undefined) {
              pnlColor = pos.pnl.startsWith('-') ? STAGED_COLORS.sell : palette.up;
            }
            hit.posCloses!.push({ id: pos.id, ...drawCancelChip(ctx, x + CANCEL_CHIP_X, entryY, pnlColor) });
            // Owner: a LIVE position row keeps ONLY the ✕ and the P&L box — the
            // Buy/Sell marker and the draft grip tag are HIDDEN (they speak of the
            // draft that made the position). The box is the SL/TP handle (same
            // drawHandle, same palette red/teal as the other elements) and the
            // number rides the SL/TP money format ("-$6.63").
            if (pos.pnl !== undefined) {
              // Tip: UP for long, DOWN for short. The trade size reads as
              // "10 units" after the P&L ("P&L -$19.8 · 10 units").
              // RR is recomputed from the PREVIEWED exits, so dragging SL/TP
              // updates it live exactly like the staged tag.
              const rrLabel =
                sl !== undefined && tp !== undefined ? riskRewardRatio(pos.side, pos.entry, sl, tp) : undefined;
              const label = `P&L ${pos.pnl} · ${pos.volume} units${rrLabel ? ` · RR ${rrLabel}` : ''}`;
              // Same font/metrics as drawHandle: remember the widest box so the
              // pill width stays stable while the live value reflows.
              ctx.font = '400 12px system-ui, sans-serif';
              const stable = Math.max(pnlBoxWidths.get(pos.id) ?? 0, ctx.measureText(`⋮⋮  ${label}`).width + 14);
              pnlBoxWidths.set(pos.id, stable);
              drawHandle(ctx, x + HANDLE_X, entryY, label, pnlColor, pos.side !== 'buy', stable);
            }
          }
        }
        if (sl !== undefined) {
          const slY = toY(sl);
          if (inBand(slY)) {
            if (drawLabels) {
              if (pos.stopLoss !== undefined) {
                hit.slClears!.push({ id: pos.id, ...drawCancelChip(ctx, x + CANCEL_CHIP_X, slY, STAGED_COLORS.sl) });
              }
              const slMoney =
                drag && drag.kind === 'sl' && drag.id === pos.id && drag.money !== undefined ? drag.money : pos.slMoney;
              exitHandle(slY, 'sl', slMoney, entryY);
            }
            if (pos.stopLoss !== undefined) {
              hit.slLines!.push({ id: pos.id, y: slY });
            }
          }
        } else {
          const slY = floatingExitY(entryY, 'sl', pos.side);
          if (drawLabels && inBand(slY)) {
            hit.slHandles!.push({ id: pos.id, ...exitHandle(slY, 'sl', undefined, entryY) });
          }
        }
        if (tp !== undefined) {
          const tpY = toY(tp);
          if (inBand(tpY)) {
            if (drawLabels) {
              if (pos.takeProfit !== undefined) {
                hit.tpClears!.push({ id: pos.id, ...drawCancelChip(ctx, x + CANCEL_CHIP_X, tpY, STAGED_COLORS.tp) });
              }
              const tpMoney =
                drag && drag.kind === 'tp' && drag.id === pos.id && drag.money !== undefined ? drag.money : pos.tpMoney;
              exitHandle(tpY, 'tp', tpMoney, entryY);
            }
            if (pos.takeProfit !== undefined) {
              hit.tpLines!.push({ id: pos.id, y: tpY });
            }
          }
        } else {
          const tpY = floatingExitY(entryY, 'tp', pos.side);
          if (drawLabels && inBand(tpY)) {
            hit.tpHandles!.push({ id: pos.id, ...exitHandle(tpY, 'tp', undefined, entryY) });
          }
        }
      }
      // Forget widths of positions that are gone (ids may be recycled later).
      const livePositionIds = new Set(state.positions.map((pos) => pos.id));
      for (const id of pnlBoxWidths.keys()) {
        if (!livePositionIds.has(id)) {
          pnlBoxWidths.delete(id);
        }
      }

      // ── Pending orders: the same staged row at the order price (no P&L).
      for (const order of state.orders) {
        const sideColor = order.side === 'buy' ? STAGED_COLORS.buy : STAGED_COLORS.sell;
        const price = preview('order', order.id, order.price) ?? order.price;
        const orderDrag = drag?.kind === 'order' && drag.id === order.id ? drag : undefined;
        const previewedStopLoss = orderDrag?.exitPreview ? orderDrag.stopLoss : order.stopLoss;
        const previewedTakeProfit = orderDrag?.exitPreview ? orderDrag.takeProfit : order.takeProfit;
        const lineY = toY(price);
        if (inBand(lineY)) {
          if (drawLabels) {
            hit.orderCancels!.push({ id: order.id, ...drawCancelChip(ctx, x + CANCEL_CHIP_X, lineY, sideColor) });
            // Side marker: the SAME handle box as the order preview (tip up for
            // buy, down for sell) — the old filled pill stood out from the rest.
            const sideBox = drawHandle(
              ctx,
              x + HANDLE_X,
              lineY,
              order.side === 'buy' ? 'Buy' : 'Sell',
              sideColor,
              order.side !== 'buy',
            );
            qtyTag(
              sideBox.x + sideBox.w + 6,
              lineY,
              `⋮⋮  |  ${order.quantity}  |  ${titleCase(order.label)}`,
              sideColor,
            );
          }
          hit.orderLines!.push({ id: order.id, y: lineY });
        }
        // Order exits: same rows as position exits (money labels, tip toward
        // the order price line) AND draggable — the modify wire carries
        // stop_loss/take_profit for pending orders too. Hit ids carry the
        // `order:` prefix so the drag handler can pick the right flow.
        const orderKey = `order:${order.id}`;
        const sl = preview('sl', orderKey, previewedStopLoss);
        if (sl === undefined) {
          const slY = floatingExitY(lineY, 'sl', order.side);
          if (drawLabels && inBand(slY)) {
            hit.slHandles!.push({ id: orderKey, ...exitHandle(slY, 'sl', undefined, lineY) });
          }
        } else {
          const slY = toY(sl);
          if (inBand(slY)) {
            if (drawLabels) {
              if (order.stopLoss !== undefined) {
                hit.slClears!.push({ id: orderKey, ...drawCancelChip(ctx, x + CANCEL_CHIP_X, slY, STAGED_COLORS.sl) });
              }
              const slMoney =
                drag && drag.kind === 'sl' && drag.id === orderKey && drag.money !== undefined
                  ? drag.money
                  : order.slMoney;
              exitHandle(slY, 'sl', slMoney, lineY);
            }
            if (order.stopLoss !== undefined) {
              hit.slLines!.push({ id: orderKey, y: slY });
            }
          }
        }
        const tp = preview('tp', orderKey, previewedTakeProfit);
        if (tp === undefined) {
          const tpY = floatingExitY(lineY, 'tp', order.side);
          if (drawLabels && inBand(tpY)) {
            hit.tpHandles!.push({ id: orderKey, ...exitHandle(tpY, 'tp', undefined, lineY) });
          }
        } else {
          const tpY = toY(tp);
          if (inBand(tpY)) {
            if (drawLabels) {
              if (order.takeProfit !== undefined) {
                hit.tpClears!.push({ id: orderKey, ...drawCancelChip(ctx, x + CANCEL_CHIP_X, tpY, STAGED_COLORS.tp) });
              }
              const tpMoney =
                drag && drag.kind === 'tp' && drag.id === orderKey && drag.money !== undefined
                  ? drag.money
                  : order.tpMoney;
              exitHandle(tpY, 'tp', tpMoney, lineY);
            }
            if (order.takeProfit !== undefined) {
              hit.tpLines!.push({ id: orderKey, y: tpY });
            }
          }
        }
      }

      ctx.restore();

      state.hit = hit;
    },
  };
}
