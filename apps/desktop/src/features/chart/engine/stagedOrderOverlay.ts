import type { OverlayRenderer } from './overlayTypes';
import type { RiskSide } from '../../../shared/bridge/types';
import { palette } from '../../../shared/theme/palette';

/**
 * TradingView-style staged-order widget, drawn as a `ui`-layer overlay. Native
 * price-axis labels render outside the chart pane. The overlay ONLY paints: all
 * input goes through capture-phase pointer/touch handlers App.tsx binds to the
 * chart host, which hit-test against the geometry recorded here on every frame
 * (`state.hit`, ±6px grab). Nothing is ever dispatched from this widget — it
 * only mirrors the ticket fields (entry / slOn+stopLoss / tpOn+takeProfit).
 *
 * Rendering and input use chart-host CSS pixels. The series primitive handles
 * Retina backing-store scaling; capture handlers claim only actual gestures.
 */

export interface StagedOrderLevels {
  side: RiskSide;
  /** NaN hides the widget (ticket price cleared while staged). */
  entry: number;
  /** null = level unset (no line drawn, handle floats near the entry line). */
  stopLoss: number | null;
  takeProfit: number | null;
  volume: string;
  orderKindLabel: string;
  /** Signed money at the level ('-$50' / '+$60') in the ACCOUNT currency.
   *  Only for SET levels — undefined keeps the plain "SL"/"TP" handle (owner:
   *  "only when both TP and SL are set"). */
  slMoney?: string;
  tpMoney?: string;
  /** Risk:reward ratio, shown only when both correctly sided exit levels exist. */
  riskRewardLabel?: string;
}

export interface StagedHitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface StagedHitCircle {
  x: number;
  y: number;
  r: number;
}

export interface StagedOrderState {
  /** null = not staged. Written by App every render via the mirror effect. */
  order: StagedOrderLevels | null;
  /** Instrument digits used for every price the widget formats. */
  digits: number;
  /** Epoch ms when the current bar closes — drives the axis countdown tag. */
  barCloseAt?: number;
  currentPrice?: number;
  /** Fresh geometry every paint; read by the host pointer handlers. */
  hit: {
    chartRect?: { x: number; y: number; width: number; height: number };
    /** Viewport px → price inverse transform from the last paint. */
    toPrice?: (y: number) => number;
    entryLineY?: number;
    /** Set SL/TP line y — the WHOLE line is draggable (order-price-line rule),
     *  not just the small handle box. */
    slLineY?: number;
    tpLineY?: number;
    entryCancel?: StagedHitCircle;
    slHandle?: StagedHitRect;
    slCancel?: StagedHitCircle;
    tpHandle?: StagedHitRect;
    tpCancel?: StagedHitCircle;
    /** Viewport snapshots for the dev-only test helper (pan/zoom assertions). */
    priceRange?: { min: number; max: number };
    barSpacing?: number;
    /** zoom() mutates barWidth (barSpacing stays fixed) — test watches this. */
    barWidth?: number;
    offset?: number;
    visibleRange?: { from: number; to: number };
  };
}

export const STAGED_COLORS = {
  buy: palette.buy,
  sell: palette.sell,
  sl: palette.warn,
  tp: palette.tp,
  text: palette.textSecondary,
  surface: palette.panel,
} as const;

/** ±px slop around painted geometry when hit-testing pointerdown. */
export const STAGED_GRAB = 6;

/** Corner radius of the row widgets (✕ chip, handle boxes) — one value so the
 *  ✕ and the SL/TP/Buy boxes keep the same corner language. */
export const WIDGET_RADIUS = 4;

/** Left inset of the row widgets (✕ chip, handles, tags) from chartRect's left
 *  edge — owner: the panels must not hug the left border. The row geometry is
 *  verbatim across the two overlays; only this shared inset moved. */
export const ROW_INSET = 24;
/** ✕ chip CENTER x offset from chartRect.x (inset + the 10px chip half-size). */
export const CANCEL_CHIP_X = ROW_INSET + 10;
/** Handle/tag column x offset from chartRect.x (chip right edge + 6px gap). */
export const HANDLE_X = ROW_INSET + 26;

export function hitCircle(circle: StagedHitCircle | undefined, x: number, y: number): boolean {
  if (!circle) {
    return false;
  }
  return Math.hypot(x - circle.x, y - circle.y) <= circle.r + STAGED_GRAB;
}

export function hitRect(rect: StagedHitRect | undefined, x: number, y: number): boolean {
  if (!rect) {
    return false;
  }
  return (
    x >= rect.x - STAGED_GRAB &&
    x <= rect.x + rect.w + STAGED_GRAB &&
    y >= rect.y - STAGED_GRAB &&
    y <= rect.y + rect.h + STAGED_GRAB
  );
}

export function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Pointed (pentagon/arrow) outline tag: grip + segments, tip on the right. */
export function tagPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, tip: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - tip, y);
  ctx.lineTo(x + w, y + h / 2);
  ctx.lineTo(x + w - tip, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

/** Draws a 20×20 rounded-square cancel chip (same corner radius as the SL/TP
 *  handle boxes) with a stroke-✕ — never the U+2715 glyph: glyph bearings drift
 *  per webview/font and left the mark visibly off-center. Returns the circle
 *  that circumscribes the square, so every painted pixel stays hittable. Shared
 *  with positionOverlay so the ✕ can never drift between the preview and the
 *  live overlay. */
export function drawCancelChip(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): StagedHitCircle {
  const r = 10;
  roundedRect(ctx, cx - r, cy - r, r * 2, r * 2, WIDGET_RADIUS);
  ctx.fillStyle = STAGED_COLORS.surface;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.75;
  const arm = 2.4;
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy - arm);
  ctx.lineTo(cx + arm, cy + arm);
  ctx.moveTo(cx + arm, cy - arm);
  ctx.lineTo(cx - arm, cy + arm);
  ctx.stroke();
  ctx.lineCap = 'butt';
  return { x: cx, y: cy, r };
}

/** Draws a cancel chip and records it for the host pointer handlers. */
function cancelChip(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  color: string,
  hit: StagedOrderState['hit'],
  key: 'entryCancel' | 'slCancel' | 'tpCancel',
) {
  hit[key] = drawCancelChip(ctx, cx, cy, color);
}

/** Which half of the two-pass z-order a row overlay paints (chart/overlays.ts):
 *  'lines' = risk zones, 'labels' = chips/handles/tags. Native price lines
 *  render underneath the overlay primitive. */
export type OverlayPass = 'lines' | 'labels';

export function createStagedOrderOverlay(state: StagedOrderState, pass: OverlayPass): OverlayRenderer {
  return {
    // `ui` layer: row widgets render without a chartRect clip; native price
    // labels are rendered by Lightweight Charts.
    descriptor: { id: `mt5-staged-order-${pass}`, name: `Staged Order (${pass})`, layer: 'ui' },
    render(ctx, { viewport }) {
      const { x, y, width, height } = viewport.chartRect;
      // Two-pass z-index (features/chart/engine/overlays.ts): this pass paints risk zones; the
      // native price lines are managed by PriceLineController. The other pass
      // paints row labels.
      const drawLines = pass === 'lines';
      const drawLabels = pass === 'labels';
      const { min, max } = viewport.priceRange;
      const hit: StagedOrderState['hit'] = {};
      // Viewport snapshots for the dev test helper (pan/zoom E2E assertions).
      hit.priceRange = { min, max };
      hit.barSpacing = viewport.barSpacing;
      hit.barWidth = viewport.barWidth;
      hit.offset = viewport.offset;
      hit.visibleRange = { from: viewport.visibleRange.from, to: viewport.visibleRange.to };

      if (width <= 0 || height <= 0 || !(max > min)) {
        state.hit = hit;
        return;
      }
      const toY = viewport.priceToY;
      const toPrice = viewport.yToPrice;
      hit.chartRect = { x, y, width, height };
      hit.toPrice = toPrice;

      const order = state.order;
      const entryValid = order !== null && Number.isFinite(order.entry) && order.entry > 0;
      if (!order || !entryValid) {
        state.hit = hit;
        // Valid exit levels remain visible through native price lines while
        // the entry is temporarily cleared during ticket editing.
        return;
      }

      const sideColor = order.side === 'buy' ? STAGED_COLORS.buy : STAGED_COLORS.sell;
      const entryY = toY(order.entry);
      // Money at the exits (account currency) — only when the level is set.
      const slLabel = order.slMoney ? `SL ${order.slMoney}` : 'SL';
      const tpLabel = order.tpMoney ? `TP ${order.tpMoney}` : 'TP';

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.textBaseline = 'middle';
      // Deterministic text state: the chart leaves textAlign wherever its own
      // label pass ended, and a handle drawn before any cancelChip used to
      // inherit 'center' — which shoved the ⋮⋮ grip half out of its box.
      ctx.textAlign = 'left';

      // Risk zones (same language the owner approved on the draft overlay):
      // entry↔SL red/brown, entry↔TP green, 12% fill.
      const zone = (level: number | null, color: string) => {
        if (level === null || !Number.isFinite(level)) {
          return;
        }
        const levelY = toY(level);
        if (levelY < y - height || levelY > y + height * 2) {
          return;
        }
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = color;
        ctx.fillRect(x, Math.min(entryY, levelY), width, Math.abs(levelY - entryY));
        ctx.globalAlpha = 1;
      };
      if (drawLines) {
        zone(order.stopLoss, palette.sellSoft);
        zone(order.takeProfit, palette.accent);
      }

      // ── ENTRY line + inline chips: (✕) unstage · side pill · pointed qty tag.
      // Draw first so the TP/SL handles remain visible above the price handle
      // when their hit boxes overlap it.
      const inView = entryY >= y - 20 && entryY <= y + height + 20;
      if (inView) {
        if (drawLabels) {
          cancelChip(ctx, x + CANCEL_CHIP_X, entryY, sideColor, hit, 'entryCancel');

          // Side marker (visual only — side is owned by the ticket quote row) in
          // the SAME handle style as the SL/TP boxes (owner: the marker must look
          // the same before the entry into the transaction). Tip: UP for long,
          // DOWN for short.
          const sideBox = drawHandle(
            ctx,
            x + HANDLE_X,
            entryY,
            order.side === 'buy' ? 'Buy' : 'Sell',
            sideColor,
            order.side !== 'buy',
          );
          const cx = sideBox.x + sideBox.w + 6;

          // Pointed tag: grip dots + qty + order type, " | " separators (TV look).
          ctx.font = '600 12px system-ui, sans-serif';
          const qty = order.volume.trim() || '—';
          const tagText = `⋮⋮  |  ${qty}  |  ${order.orderKindLabel}${order.riskRewardLabel ? `  |  RR ${order.riskRewardLabel}` : ''}`;
          const tagW = ctx.measureText(tagText).width + 16;
          tagPath(ctx, cx, entryY - 10, tagW + 8, 20, 7);
          ctx.fillStyle = STAGED_COLORS.surface;
          ctx.fill();
          ctx.strokeStyle = sideColor;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = STAGED_COLORS.text;
          ctx.fillText(tagText, cx + 8, entryY + 0.5);
        }

        hit.entryLineY = entryY;
      }

      ctx.font = '600 12px system-ui, sans-serif';

      // ── SL: dotted line when set (✕ chip to unset), handle always present.
      // Unset handle floats on the SL side of the entry line FOR THE ORDER SIDE
      // (SELL: SL is above entry → handle above, tip points down at the line;
      //  BUY: SL is below entry → handle below, tip points up).
      let slY: number | null = null;
      if (order.stopLoss !== null && Number.isFinite(order.stopLoss) && order.stopLoss > 0) {
        slY = toY(order.stopLoss);
        if (slY >= y - 20 && slY <= y + height + 20) {
          if (drawLabels) {
            cancelChip(ctx, x + CANCEL_CHIP_X, slY, STAGED_COLORS.sl, hit, 'slCancel');
            hit.slHandle = drawHandle(ctx, x + HANDLE_X, slY, slLabel, STAGED_COLORS.sl, slY < entryY);
          }
          hit.slLineY = slY;
        }
      } else {
        const floatAbove = order.side === 'sell';
        const floatY = floatAbove ? entryY - 30 : entryY + 30;
        if (drawLabels && floatY >= y - 4 && floatY <= y + height + 4) {
          hit.slHandle = drawHandle(ctx, x + HANDLE_X, floatY, 'SL', STAGED_COLORS.sl, floatAbove);
        }
      }

      // ── TP: mirrored below the entry line when unset.
      let tpY: number | null = null;
      if (order.takeProfit !== null && Number.isFinite(order.takeProfit) && order.takeProfit > 0) {
        tpY = toY(order.takeProfit);
        if (tpY >= y - 20 && tpY <= y + height + 20) {
          if (drawLabels) {
            cancelChip(ctx, x + CANCEL_CHIP_X, tpY, STAGED_COLORS.tp, hit, 'tpCancel');
            hit.tpHandle = drawHandle(ctx, x + HANDLE_X, tpY, tpLabel, STAGED_COLORS.tp, tpY < entryY);
          }
          hit.tpLineY = tpY;
        }
      } else {
        const floatAbove = order.side === 'buy';
        const floatY = floatAbove ? entryY - 30 : entryY + 30;
        if (drawLabels && floatY >= y - 4 && floatY <= y + height + 4) {
          // tip always points AT the entry line: down when above, up when below.
          hit.tpHandle = drawHandle(ctx, x + HANDLE_X, floatY, 'TP', STAGED_COLORS.tp, floatAbove);
        }
      }

      ctx.restore();
      state.hit = hit;
    },
  };
}

/** Draggable outline handle tag ("⋮⋮ SL"/"⋮⋮ TP"); tip points at its line. */
export function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  centerY: number,
  label: string,
  color: string,
  tipDown: boolean,
  /** Optional floor for the box width: lets a caller pin a stable width so a
   *  live value (e.g. the position P&L) does not resize the box every frame. */
  minWidth?: number,
): StagedHitRect {
  // 12px regular — same type size as the side pill (owner); no bold.
  ctx.font = '400 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  const w = Math.max(ctx.measureText(`⋮⋮  ${label}`).width + 14, minWidth ?? 0);
  const h = 20;
  const top = centerY - h / 2;
  roundedRect(ctx, x, top, w, h, WIDGET_RADIUS);
  ctx.fillStyle = STAGED_COLORS.surface;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Pointer tip toward the line the handle controls (entry line while unset).
  ctx.beginPath();
  if (tipDown) {
    ctx.moveTo(x + 8, top + h);
    ctx.lineTo(x + 16, top + h);
    ctx.lineTo(x + 12, top + h + 5);
  } else {
    ctx.moveTo(x + 8, top);
    ctx.lineTo(x + 16, top);
    ctx.lineTo(x + 12, top - 5);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(`⋮⋮  ${label}`, x + 7, centerY + 0.5);
  return { x, y: top, w, h };
}
