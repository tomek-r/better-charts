import { palette } from '../../../shared/theme/palette';

export interface TradingHitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TradingHitCircle {
  x: number;
  y: number;
  r: number;
}

export const TRADING_COLORS = {
  buy: palette.buy,
  sell: palette.sell,
  sl: palette.warn,
  tp: palette.tp,
  text: palette.textSecondary,
  surface: palette.panel,
} as const;

/** Corner radius and row anchors shared by staged and live trading overlays. */
export const WIDGET_RADIUS = 4;
export const ROW_INSET = 24;
/** Cancel chip center and handle/tag column offsets from chartRect.x. */
export const CANCEL_CHIP_X = ROW_INSET + 10;
export const HANDLE_X = ROW_INSET + 26;

/** Which half of the two-pass z-order a row overlay paints. */
export type OverlayPass = 'lines' | 'labels';

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

/** Draw a 20×20 cancel chip and return the circle that covers its painted area. */
export function drawCancelChip(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): TradingHitCircle {
  const r = 10;
  roundedRect(ctx, cx - r, cy - r, r * 2, r * 2, WIDGET_RADIUS);
  ctx.fillStyle = TRADING_COLORS.surface;
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

/** Draggable outline handle tag; its tip points toward the controlled line. */
export function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  centerY: number,
  label: string,
  color: string,
  tipDown: boolean,
  /** Right-align the live amount so reserved space stays before it, not after it. */
  trailing?: { text: string; amount: { text: string; width: number } },
): TradingHitRect {
  ctx.font = '400 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  const leadingWidth = ctx.measureText(`⋮⋮  ${label}`).width;
  const trailingOffset =
    leadingWidth + (trailing ? Math.max(trailing.amount.width, ctx.measureText(trailing.amount.text).width) : 0);
  const w = (trailing ? trailingOffset + ctx.measureText(trailing.text).width : leadingWidth) + 14;
  const h = 20;
  const top = centerY - h / 2;
  roundedRect(ctx, x, top, w, h, WIDGET_RADIUS);
  ctx.fillStyle = TRADING_COLORS.surface;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
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
  if (trailing) {
    ctx.textAlign = 'right';
    ctx.fillText(trailing.amount.text, x + 7 + trailingOffset, centerY + 0.5);
    ctx.textAlign = 'left';
    ctx.fillText(trailing.text, x + 7 + trailingOffset, centerY + 0.5);
  }
  return { x, y: top, w, h };
}
