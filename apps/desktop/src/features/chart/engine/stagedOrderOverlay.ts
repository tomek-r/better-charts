import {
  paintTradingLabel,
  type TradingLabelHit,
  type TradingLabelTarget,
  type TradingLabelLayoutState,
} from './labelLayout';
import type { OverlayRenderer } from './overlayTypes';
import type { RiskSide } from '../../../shared/bridge/types';
import { palette } from '../../../shared/theme/palette';
import {
  CANCEL_CHIP_X,
  bindViewportHit,
  drawCancelChip,
  fillRiskZone,
  drawHandle,
  HANDLE_X,
  roundedRect,
  tagPath,
  TRADING_COLORS,
  WIDGET_RADIUS,
  type TradingHitCircle,
  type TradingHitRect,
  type OverlayPass,
} from './tradingOverlayDrawing';

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

/** Allowed SL prices for a risk-sized draft (mirrors the order-ticket domain band). */
export interface StagedSlBand {
  nearPrice: number;
  farPrice: number;
  /** No price satisfies both edges: nothing is shaded or clamped. */
  empty: boolean;
  nearHint: string;
  farHint: string;
  emptyHint: string;
}

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
  /** Risk sizing only; absent in units mode or without usable broker metadata. */
  slBand?: StagedSlBand;
}

export interface StagedOrderState {
  /** null = not staged. Written by App every render via the mirror effect. */
  order: StagedOrderLevels | null;
  /** Why no SL is allowed (empty band); set by the gestures during an SL drag, cleared on release. */
  slClampHint?: string;
  /** The band edge currently holding the SL drag; its permanent label is emphasised. */
  slClampEdge?: 'near' | 'far';
  /** Instrument digits used for every price the widget formats. */
  digits: number;
  /** Epoch ms when the current bar closes — drives the axis countdown tag. */
  barCloseAt?: number;
  currentPrice?: number;
  /** Fresh geometry every paint; read by the host pointer handlers. */
  hit: {
    labels?: TradingLabelHit[];
    chartRect?: { x: number; y: number; width: number; height: number };
    /** Viewport px → price inverse transform from the last paint. */
    toPrice?: (y: number) => number;
    entryLineY?: number;
    /** Set SL/TP line y — the WHOLE line is draggable (order-price-line rule),
     *  not just the small handle box. */
    slLineY?: number;
    tpLineY?: number;
    /** Viewport y of the allowed-SL band edges (risk sizing only). */
    slBandY?: { nearY: number; farY: number };
    /** Painted band edge labels (viewport px). Informational only: never a grab target. */
    slBandLabels?: Array<TradingHitRect & { edge: 'near' | 'far'; text: string }>;
    entryCancel?: TradingHitCircle;
    slHandle?: TradingHitRect;
    slCancel?: TradingHitCircle;
    tpHandle?: TradingHitRect;
    tpCancel?: TradingHitCircle;
    /** Viewport snapshots for the dev-only test helper (pan/zoom assertions). */
    priceRange?: { min: number; max: number };
    barSpacing?: number;
    /** zoom() mutates barWidth (barSpacing stays fixed) — test watches this. */
    barWidth?: number;
    offset?: number;
    visibleRange?: { from: number; to: number };
  };
}

/** ±px slop around painted geometry when hit-testing pointerdown. */
export const STAGED_GRAB = 6;

export function hitCircle(circle: TradingHitCircle | undefined, x: number, y: number): boolean {
  if (!circle) {
    return false;
  }
  return Math.hypot(x - circle.x, y - circle.y) <= circle.r + STAGED_GRAB;
}

export function hitRect(rect: TradingHitRect | undefined, x: number, y: number): boolean {
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

/** Dotted line across the pane at each edge of the allowed-SL band; nothing is shaded. */
function paintBandEdgeLines(
  ctx: CanvasRenderingContext2D,
  chartRect: { x: number; y: number; width: number; height: number },
  { nearY, farY }: { nearY: number; farY: number },
) {
  const { x, y, width, height } = chartRect;
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = palette.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (const edgeY of [farY, nearY]) {
    if (edgeY >= y && edgeY <= y + height) {
      ctx.beginPath();
      ctx.moveTo(x, Math.round(edgeY) + 0.5);
      ctx.lineTo(x + width, Math.round(edgeY) + 0.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const BAND_LABEL_MARGIN = 12;
const BAND_LABEL_CLEARANCE = 4;

const overlaps = (a: TradingHitRect, b: TradingHitRect | undefined, clearance = BAND_LABEL_CLEARANCE) =>
  b !== undefined &&
  a.x < b.x + b.w + clearance &&
  a.x + a.w + clearance > b.x &&
  a.y < b.y + b.h + clearance &&
  a.y + a.h + clearance > b.y;

/**
 * Permanent neutral label on a band edge, in the SL/TP handle style but without grip or tip: it is not a
 * handle and records no hit area. Right-aligned in the pane so it stays clear of the left-hand SL/TP/entry
 * labels; it is dropped (not moved) when it would still touch one of them or the other band label.
 * `held` marks the edge currently holding the SL drag.
 */
function paintBandLabel(
  ctx: CanvasRenderingContext2D,
  chartRect: { x: number; y: number; width: number; height: number },
  centerY: number,
  text: string,
  held: boolean,
  occupied: Array<TradingHitRect | undefined>,
): TradingHitRect | undefined {
  ctx.font = '400 12px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 14;
  const h = 20;
  const box = { x: chartRect.x + chartRect.width - w - BAND_LABEL_MARGIN, y: centerY - h / 2, w, h };
  if (
    centerY < chartRect.y ||
    centerY > chartRect.y + chartRect.height ||
    box.x < chartRect.x ||
    occupied.some((other) => overlaps(box, other))
  ) {
    return undefined;
  }
  roundedRect(ctx, box.x, box.y, box.w, box.h, WIDGET_RADIUS);
  ctx.fillStyle = TRADING_COLORS.surface;
  ctx.fill();
  ctx.strokeStyle = held ? palette.warn : palette.muted;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = held ? palette.warnText : palette.mutedStrong;
  ctx.textAlign = 'left';
  ctx.fillText(text, box.x + 7, centerY + 0.5);
  return box;
}

/** Short pill beside the SL handle explaining why no SL level is allowed (empty band). */
function paintClampHint(ctx: CanvasRenderingContext2D, handle: TradingHitRect, text: string) {
  const width = ctx.measureText(text).width + 16;
  const left = handle.x + handle.w + 8;
  const top = handle.y;
  ctx.fillStyle = TRADING_COLORS.surface;
  ctx.fillRect(left, top, width, handle.h);
  ctx.strokeStyle = palette.warn;
  ctx.lineWidth = 1;
  ctx.strokeRect(left + 0.5, top + 0.5, width - 1, handle.h - 1);
  ctx.fillStyle = palette.warnText;
  ctx.fillText(text, left + 8, top + handle.h / 2 + 0.5);
}

export function createStagedOrderOverlay(
  state: StagedOrderState,
  pass: OverlayPass,
  labels?: TradingLabelLayoutState,
): OverlayRenderer {
  return {
    // `ui` layer: row widgets render without a chartRect clip; native price
    // labels are rendered by Lightweight Charts.
    descriptor: { id: `staged-order-${pass}`, name: `Staged Order (${pass})`, layer: 'ui' },
    render(ctx, { viewport }) {
      const { x, y, width, height } = viewport.chartRect;
      // Two-pass z-index (features/chart/engine/overlays.ts): this pass paints risk zones; the
      // native price lines are managed by PriceLineController. The other pass
      // paints row labels.
      const drawLines = pass === 'lines';
      const drawLabels = pass === 'labels';
      const { min, max } = viewport.priceRange;
      const hit: StagedOrderState['hit'] = { labels: [] };
      const row = (level: TradingLabelTarget['level'], lineY: number, draw: (labelY: number) => TradingHitRect) =>
        paintTradingLabel(ctx, viewport, hit.labels!, { source: 'staged', id: 'draft', level }, lineY, draw, labels);
      // Viewport snapshots for the dev test helper (pan/zoom E2E assertions).
      hit.priceRange = { min, max };
      hit.barSpacing = viewport.barSpacing;
      hit.barWidth = viewport.barWidth;
      hit.offset = viewport.offset;
      hit.visibleRange = { from: viewport.visibleRange.from, to: viewport.visibleRange.to };

      if (!bindViewportHit(hit, viewport)) {
        state.hit = hit;
        return;
      }
      const toY = viewport.priceToY;

      const order = state.order;
      const entryValid = order !== null && Number.isFinite(order.entry) && order.entry > 0;
      if (!order || !entryValid) {
        state.hit = hit;
        // Valid exit levels remain visible through native price lines while
        // the entry is temporarily cleared during ticket editing.
        return;
      }

      const sideColor = order.side === 'buy' ? TRADING_COLORS.buy : TRADING_COLORS.sell;
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
        fillRiskZone(ctx, viewport.chartRect, entryY, toY(level), color);
      };
      const band = order.slBand && !order.slBand.empty ? order.slBand : undefined;
      if (band) {
        hit.slBandY = { nearY: toY(band.nearPrice), farY: toY(band.farPrice) };
      }
      if (drawLines) {
        zone(order.stopLoss, palette.sellSoft);
        zone(order.takeProfit, palette.accent);
        if (band && hit.slBandY) {
          paintBandEdgeLines(ctx, viewport.chartRect, hit.slBandY);
        }
      }
      let entryTag: TradingHitRect | undefined;

      // ── ENTRY line + inline chips: (✕) unstage · side pill · pointed qty tag.
      // Draw first so the TP/SL handles remain visible above the price handle
      // when their hit boxes overlap it.
      const inView = entryY >= y - 20 && entryY <= y + height + 20;
      if (inView) {
        if (drawLabels) {
          row('entry', entryY, (labelY) => {
            cancelChip(ctx, x + CANCEL_CHIP_X, labelY, sideColor, hit, 'entryCancel');

            // Side marker (visual only — side is owned by the ticket quote row) in
            // the SAME handle style as the SL/TP boxes (owner: the marker must look
            // the same before the entry into the transaction). Tip: UP for long,
            // DOWN for short.
            const sideBox = drawHandle(
              ctx,
              x + HANDLE_X,
              labelY,
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
            tagPath(ctx, cx, labelY - 10, tagW + 8, 20, 7);
            ctx.fillStyle = TRADING_COLORS.surface;
            ctx.fill();
            ctx.strokeStyle = sideColor;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = TRADING_COLORS.text;
            ctx.fillText(tagText, cx + 8, labelY + 0.5);

            entryTag = {
              x: x + CANCEL_CHIP_X - 10,
              y: labelY - 10,
              w: cx + tagW + 8 - (x + CANCEL_CHIP_X - 10),
              h: 20,
            };
            return entryTag;
          });
        }

        hit.entryLineY = entryY;
      }

      ctx.font = '600 12px system-ui, sans-serif';

      // ── SL: dotted line when set (✕ chip to unset), handle always present.
      // Unset handle floats on the SL side of the entry line FOR THE ORDER SIDE
      // (SELL: SL is above entry → handle above, tip points down at the line;
      //  BUY: SL is below entry → handle below, tip points up).
      if (order.stopLoss !== null && Number.isFinite(order.stopLoss) && order.stopLoss > 0) {
        const slY = toY(order.stopLoss);
        if (slY >= y - 20 && slY <= y + height + 20) {
          if (drawLabels) {
            row('sl', slY, (labelY) => {
              cancelChip(ctx, x + CANCEL_CHIP_X, labelY, TRADING_COLORS.sl, hit, 'slCancel');
              hit.slHandle = drawHandle(ctx, x + HANDLE_X, labelY, slLabel, TRADING_COLORS.sl, labelY < entryY);

              const box = hit.slHandle!;
              if (state.slClampHint) {
                paintClampHint(ctx, box, state.slClampHint);
              }
              return { x: x + CANCEL_CHIP_X - 10, y: labelY - 10, w: box.x + box.w - (x + CANCEL_CHIP_X - 10), h: 20 };
            });
          }
          hit.slLineY = slY;
        }
      } else {
        const floatAbove = order.side === 'sell';
        const floatY = floatAbove ? entryY - 30 : entryY + 30;
        if (drawLabels && floatY >= y - 4 && floatY <= y + height + 4) {
          row('sl', floatY, (labelY) => {
            const box = drawHandle(ctx, x + HANDLE_X, labelY, 'SL', TRADING_COLORS.sl, floatAbove);
            hit.slHandle = box;
            return box;
          });
        }
      }

      // ── TP: mirrored below the entry line when unset.
      if (order.takeProfit !== null && Number.isFinite(order.takeProfit) && order.takeProfit > 0) {
        const tpY = toY(order.takeProfit);
        if (tpY >= y - 20 && tpY <= y + height + 20) {
          if (drawLabels) {
            row('tp', tpY, (labelY) => {
              cancelChip(ctx, x + CANCEL_CHIP_X, labelY, TRADING_COLORS.tp, hit, 'tpCancel');
              hit.tpHandle = drawHandle(ctx, x + HANDLE_X, labelY, tpLabel, TRADING_COLORS.tp, labelY < entryY);

              const box = hit.tpHandle!;
              return { x: x + CANCEL_CHIP_X - 10, y: labelY - 10, w: box.x + box.w - (x + CANCEL_CHIP_X - 10), h: 20 };
            });
          }
          hit.tpLineY = tpY;
        }
      } else {
        const floatAbove = order.side === 'buy';
        const floatY = floatAbove ? entryY - 30 : entryY + 30;
        if (drawLabels && floatY >= y - 4 && floatY <= y + height + 4) {
          // tip always points AT the entry line: down when above, up when below.
          row('tp', floatY, (labelY) => {
            const box = drawHandle(ctx, x + HANDLE_X, labelY, 'TP', TRADING_COLORS.tp, floatAbove);
            hit.tpHandle = box;
            return box;
          });
        }
      }

      // Band edge labels last: they yield to every handle and tag drawn above.
      if (drawLabels && band && hit.slBandY) {
        const occupied: Array<TradingHitRect | undefined> = [hit.slHandle, hit.tpHandle, entryTag];
        hit.slBandLabels = [];
        for (const edge of ['far', 'near'] as const) {
          const edgeY = edge === 'far' ? hit.slBandY.farY : hit.slBandY.nearY;
          const text = edge === 'far' ? band.farHint : band.nearHint;
          const box = paintBandLabel(ctx, viewport.chartRect, edgeY, text, state.slClampEdge === edge, occupied);
          if (box) {
            occupied.push(box);
            hit.slBandLabels.push({ edge, text, ...box });
          }
        }
      }

      ctx.restore();
      state.hit = hit;
    },
  };
}
