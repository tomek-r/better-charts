import type { TradingLabelHit, TradingLabelLayoutState, TradingLabelTarget } from './labels/tradingLabelTypes';
import { paintTradingLabel } from './labels/paintTradingLabel';
import { orderOverlayId } from './overlayIds';
import { dragPrice } from './positionDragPreview';
import { paintExitRow, paintOrderEntryRow, paintPositionEntryRow, type PositionRowEnvironment } from './positionRows';
import type { PositionHitLists, PositionOverlayState } from './positionOverlayTypes';
import { bindViewportHit, fillRiskZone, type OverlayPass, type TradingHitRect } from './tradingOverlayDrawing';
import type { OverlayRenderer } from '../surface/overlayRenderer';
import { palette } from '../../../../shared/theme/palette';

export function createPositionOverlay(
  state: PositionOverlayState,
  pass: OverlayPass,
  labels?: TradingLabelLayoutState,
): OverlayRenderer {
  // Size the P&L column from actual amounts only. Wider values expand it;
  // shorter values never move the units and RR back to the left.
  // (The `lines` pass never writes it; the two renderers are independent.)
  const pnlColumnWidths = new Map<string, number>();
  return {
    // `ui` layer: row widgets render over the chart. Two-pass z-order (`lines`
    // before `labels`, features/chart/engine/surface/buildChartPlugins.ts) keeps risk zones beneath row labels;
    // native price lines and their axis labels render below this primitive.
    id: `position-overlay-${pass}`,
    render(ctx, { viewport }) {
      const { x, y, width, height } = viewport.chartRect;
      const drawLines = pass === 'lines';
      const drawLabels = pass === 'labels';
      const labelHits: TradingLabelHit[] = [];
      const hit: PositionOverlayState['hit'] = { labels: labelHits };

      if (!bindViewportHit(hit, viewport)) {
        state.hit = hit;
        return;
      }
      const toY = viewport.priceToY;
      const hitLists: PositionHitLists = {
        orderLines: [],
        slLines: [],
        tpLines: [],
        slHandles: [],
        tpHandles: [],
        posCloses: [],
        posPartials: [],
        orderCancels: [],
        slClears: [],
        tpClears: [],
      };
      Object.assign(hit, hitLists);

      const inBand = (lineY: number) => lineY >= y && lineY <= y + height;
      const drag = state.drag;
      const env: PositionRowEnvironment = {
        ctx,
        chartX: x,
        drawLabels,
        toY,
        inBand,
        paintRow: (
          id: string,
          level: TradingLabelTarget['level'],
          lineY: number,
          draw: (labelY: number) => TradingHitRect,
        ) => paintTradingLabel(ctx, viewport, labelHits, { source: 'trading', id, level }, lineY, draw, labels),
        hits: hitLists,
        drag,
        pnlColumnWidths,
      };
      // 12% risk zone between the entry row and an exit.
      const zone = (entryY: number, levelY: number, color: string) =>
        fillRiskZone(ctx, viewport.chartRect, entryY, levelY, color);

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, width, height);
      ctx.clip();
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      for (const pos of state.positions) {
        const entryY = toY(pos.entry);
        const sl = dragPrice(drag, 'sl', pos.id, pos.stopLoss);
        const tp = dragPrice(drag, 'tp', pos.id, pos.takeProfit);
        if (drawLines) {
          if (sl !== undefined) {
            zone(entryY, toY(sl), palette.sellSoft);
          }
          if (tp !== undefined) {
            zone(entryY, toY(tp), palette.accent);
          }
        }
        if (inBand(entryY)) {
          paintPositionEntryRow(env, pos, entryY, sl, tp);
        }
        paintExitRow(env, {
          kind: 'sl',
          id: pos.id,
          side: pos.side,
          level: sl,
          setLevel: pos.stopLoss,
          money: pos.slMoney,
          entryY,
        });
        paintExitRow(env, {
          kind: 'tp',
          id: pos.id,
          side: pos.side,
          level: tp,
          setLevel: pos.takeProfit,
          money: pos.tpMoney,
          entryY,
        });
      }
      // Forget widths of positions that are gone (ids may be recycled later).
      const livePositionIds = new Set(state.positions.map((pos) => pos.id));
      for (const id of pnlColumnWidths.keys()) {
        if (!livePositionIds.has(id)) {
          pnlColumnWidths.delete(id);
        }
      }

      // Pending orders: the same staged row at the order price (no P&L). Exit
      // hit ids carry the `order:` prefix so the drag handler can pick the
      // right flow; the modify wire carries stop_loss/take_profit for orders too.
      for (const order of state.orders) {
        const price = dragPrice(drag, 'order', order.id, order.price) ?? order.price;
        const orderDrag = drag?.kind === 'order' && drag.id === order.id ? drag : undefined;
        const previewedStopLoss = orderDrag?.exitPreview ? orderDrag.stopLoss : order.stopLoss;
        const previewedTakeProfit = orderDrag?.exitPreview ? orderDrag.takeProfit : order.takeProfit;
        const orderId = orderOverlayId(order.id);
        const sl = dragPrice(drag, 'sl', orderId, previewedStopLoss);
        const tp = dragPrice(drag, 'tp', orderId, previewedTakeProfit);
        const lineY = toY(price);
        if (inBand(lineY)) {
          paintOrderEntryRow(env, order, orderId, price, lineY, sl, tp);
          hitLists.orderLines.push({ id: order.id, y: lineY });
        }
        paintExitRow(env, {
          kind: 'sl',
          id: orderId,
          side: order.side,
          level: sl,
          setLevel: order.stopLoss,
          money: order.slMoney,
          entryY: lineY,
        });
        paintExitRow(env, {
          kind: 'tp',
          id: orderId,
          side: order.side,
          level: tp,
          setLevel: order.takeProfit,
          money: order.tpMoney,
          entryY: lineY,
        });
      }

      ctx.restore();

      state.hit = hit;
    },
  };
}
