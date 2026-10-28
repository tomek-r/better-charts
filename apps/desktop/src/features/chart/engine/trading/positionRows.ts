import type { TradingLabelTarget } from './labels/tradingLabelTypes';
import { dragMoney } from './positionDragPreview';
import type { OrderLine, PositionDrag, PositionHitLists, PositionLine } from './positionOverlayTypes';
import {
  CANCEL_CHIP_X,
  HANDLE_X,
  PARTIAL_CHIP_OFFSET,
  ROW_FONT_REGULAR,
  ROW_HALF_HEIGHT,
  TRADING_COLORS,
  drawCancelChip,
  drawHandle,
  drawPartialChip,
  exitHandle,
  exitRowRect,
  floatingExitY,
  qtyTag,
  rowRectTo,
  titleCase,
  type TradingHitRect,
} from './tradingOverlayDrawing';
import type { RiskSide } from '../../../../shared/bridge/types';
import { MINUS_SIGN } from '../../../../shared/format';
import { palette } from '../../../../shared/theme/palette';
import { riskRewardRatio } from '../../../../shared/trading/riskReward';

/** What the row painters read from the frame being rendered. */
export interface PositionRowEnvironment {
  ctx: CanvasRenderingContext2D;
  /** Left edge of the pane: every row offset is measured from it. */
  chartX: number;
  /** Rows paint only in the labels pass; the lines pass skips them. */
  drawLabels: boolean;
  toY: (price: number) => number;
  inBand: (lineY: number) => boolean;
  paintRow: (
    id: string,
    level: TradingLabelTarget['level'],
    lineY: number,
    draw: (labelY: number) => TradingHitRect,
  ) => void;
  hits: PositionHitLists;
  drag: PositionDrag | null;
  /** Widest P&L amount seen per position id, so the column never shrinks back. */
  pnlColumnWidths: Map<string, number>;
}

/** The ✕ echoes the P&L state, red losing and green profiting, rather than the side: a red sell ✕
 *  beside a green P&L read as a contradiction. Before the first P&L it falls back to the side colour. */
function pnlColorFor(pnl: string | undefined, sideColor: string): string {
  if (pnl === undefined) {
    return sideColor;
  }
  return pnl.startsWith(MINUS_SIGN) ? TRADING_COLORS.sell : palette.up;
}

/** A live position row keeps only the ✕ (plus ▾ when partial close is available) and the P&L box. */
export function paintPositionEntryRow(
  env: PositionRowEnvironment,
  position: PositionLine,
  entryY: number,
  stopLoss: number | undefined,
  takeProfit: number | undefined,
): void {
  if (!env.drawLabels) {
    return;
  }
  const { ctx, chartX, hits } = env;
  const sideColor = position.side === 'buy' ? TRADING_COLORS.buy : TRADING_COLORS.sell;
  env.paintRow(position.id, 'entry', entryY, (labelY) => {
    const pnlColor = pnlColorFor(position.pnl, sideColor);
    hits.posCloses.push({ id: position.id, ...drawCancelChip(ctx, chartX + CANCEL_CHIP_X, labelY, pnlColor) });
    // The ▾ joins the ✕ and pushes the P&L box right by its width.
    const chipsShift = position.partialClose ? PARTIAL_CHIP_OFFSET : 0;
    if (position.partialClose) {
      const partialX = chartX + CANCEL_CHIP_X + PARTIAL_CHIP_OFFSET;
      hits.posPartials.push({ id: position.id, ...drawPartialChip(ctx, partialX, labelY, pnlColor) });
    }
    let right = chartX + CANCEL_CHIP_X + ROW_HALF_HEIGHT + chipsShift;
    if (position.pnl !== undefined) {
      // Tip: UP for long, DOWN for short. RR follows the previewed exits, so dragging SL/TP updates it live.
      const rrLabel =
        stopLoss !== undefined && takeProfit !== undefined
          ? riskRewardRatio(position.side, position.entry, stopLoss, takeProfit)
          : undefined;
      ctx.font = ROW_FONT_REGULAR;
      const columnWidth = Math.max(env.pnlColumnWidths.get(position.id) ?? 0, ctx.measureText(position.pnl).width);
      env.pnlColumnWidths.set(position.id, columnWidth);
      const box = drawHandle(ctx, chartX + HANDLE_X + chipsShift, labelY, 'P&L ', pnlColor, position.side !== 'buy', {
        parts: [`${position.volume} units`, ...(rrLabel ? [`RR ${rrLabel}`] : [])],
        amount: { text: position.pnl, width: columnWidth },
      });
      right = box.x + box.w;
    }
    return rowRectTo(chartX, labelY, right);
  });
}

/** A pending order row: ✕ cancel chip, side marker, then the "⋮⋮  |  qty  |  Kind" tag. */
export function paintOrderEntryRow(
  env: PositionRowEnvironment,
  order: OrderLine,
  orderId: string,
  price: number,
  lineY: number,
  stopLoss: number | undefined,
  takeProfit: number | undefined,
): void {
  if (!env.drawLabels) {
    return;
  }
  const { ctx, chartX } = env;
  const sideColor = order.side === 'buy' ? TRADING_COLORS.buy : TRADING_COLORS.sell;
  env.paintRow(orderId, 'entry', lineY, (labelY) => {
    env.hits.orderCancels.push({ id: order.id, ...drawCancelChip(ctx, chartX + CANCEL_CHIP_X, labelY, sideColor) });
    // Same handle box as the order preview: tip up for buy, down for sell.
    const sideBox = drawHandle(
      ctx,
      chartX + HANDLE_X,
      labelY,
      order.side === 'buy' ? 'Buy' : 'Sell',
      sideColor,
      order.side !== 'buy',
    );
    const rrLabel =
      stopLoss !== undefined && takeProfit !== undefined
        ? riskRewardRatio(order.side, price, stopLoss, takeProfit)
        : undefined;
    const right = qtyTag(
      ctx,
      sideBox.x + sideBox.w + 6,
      labelY,
      `⋮⋮  |  ${order.quantity}  |  ${titleCase(order.label)}${rrLabel ? `  |  RR ${rrLabel}` : ''}`,
      sideColor,
    );
    return rowRectTo(chartX, labelY, right);
  });
}

export interface ExitRowInput {
  kind: 'sl' | 'tp';
  /** Overlay id: the position id, or the `order:` prefixed id for an order. */
  id: string;
  side: RiskSide;
  /** Price the row paints at (the drag preview when this level is being dragged); undefined floats the handle. */
  level: number | undefined;
  /** The level the position or order really carries; only a set level gets a ✕ chip and a grab line. */
  setLevel: number | undefined;
  /** Committed money label, replaced by the live one while this level is dragged. */
  money: string | undefined;
  /** Y of the entry row or order line the handle tip points toward. */
  entryY: number;
}

/** One SL/TP row: a set level paints its ✕ + money handle and a grab line, a missing one floats a plain handle. */
export function paintExitRow(env: PositionRowEnvironment, input: ExitRowInput): void {
  const { ctx, chartX, hits } = env;
  const { kind, id, entryY } = input;
  const clears = kind === 'sl' ? hits.slClears : hits.tpClears;
  const lines = kind === 'sl' ? hits.slLines : hits.tpLines;
  const handles = kind === 'sl' ? hits.slHandles : hits.tpHandles;
  const color = kind === 'sl' ? TRADING_COLORS.sl : TRADING_COLORS.tp;

  if (input.level === undefined) {
    const floatingY = floatingExitY(entryY, kind, input.side);
    if (env.drawLabels && env.inBand(floatingY)) {
      env.paintRow(id, kind, floatingY, (labelY) => {
        const box = exitHandle(ctx, chartX, labelY, kind, undefined, entryY);
        handles.push({ id, ...box });
        return box;
      });
    }
    return;
  }

  const levelY = env.toY(input.level);
  if (!env.inBand(levelY)) {
    return;
  }
  if (env.drawLabels) {
    env.paintRow(id, kind, levelY, (labelY) => {
      if (input.setLevel !== undefined) {
        clears.push({ id, ...drawCancelChip(ctx, chartX + CANCEL_CHIP_X, labelY, color) });
      }
      const box = exitHandle(ctx, chartX, labelY, kind, dragMoney(env.drag, kind, id, input.money), entryY);
      return exitRowRect(chartX, labelY, box);
    });
  }
  if (input.setLevel !== undefined) {
    lines.push({ id, y: levelY });
  }
}
