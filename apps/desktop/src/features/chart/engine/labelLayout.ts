import type { RenderViewport } from './overlayTypes';
import { palette } from '../../../shared/theme/palette';

export interface TradingLabelTarget {
  source: 'trading' | 'staged';
  id: string;
  level: 'entry' | 'sl' | 'tp';
}
export interface TradingLabelHit extends TradingLabelTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Actual price/floating-handle centre, independent of collision spacing. */
  lineY: number;
}

export function containsLabel(row: TradingLabelHit, x: number, y: number): boolean {
  return x >= row.x && x <= row.x + row.w && y >= row.y && y <= row.y + row.h;
}

/** Least-squares placement with 32px between centres (20px body + tips/gap).
 * Pool adjacent collisions so displacement is shared instead of pushing all
 * rows down. Input is sorted by desired centre; isolated rows stay in place. */
export function layoutLabelCenters(desired: number[], top: number, bottom: number): number[] {
  const spacing = 32;
  const blocks: Array<{ start: number; count: number; mean: number }> = [];
  desired.forEach((y, i) => {
    blocks.push({ start: i, count: 1, mean: y - i * spacing });
    while (blocks.length > 1 && blocks.at(-2)!.mean > blocks.at(-1)!.mean) {
      const right = blocks.pop()!;
      const left = blocks.pop()!;
      blocks.push({
        start: left.start,
        count: left.count + right.count,
        mean: (left.mean * left.count + right.mean * right.count) / (left.count + right.count),
      });
    }
  });
  const result: number[] = [];
  const lower = top + 15;
  const upper = Math.max(lower, bottom - 15 - (desired.length - 1) * spacing);
  for (const block of blocks) {
    const base = Math.max(lower, Math.min(upper, block.mean));
    for (let i = block.start; i < block.start + block.count; i++) {
      result[i] = base + i * spacing;
    }
  }
  return result;
}

/** Shared frame queue consumed by the trading-labels overlay. */
export interface TradingLabelLayoutState {
  pending: Array<{ target: TradingLabelTarget; y: number; draw: (y: number) => void }>;
}

export function paintTradingLabel(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  rows: TradingLabelHit[],
  target: TradingLabelTarget,
  lineY: number,
  draw: (labelY: number) => { x: number; y: number; w: number; h: number },
  layout?: TradingLabelLayoutState,
): void {
  const font = ctx.font;
  const paint = (labelY: number) => {
    ctx.save();
    const { x, y, width, height } = viewport.chartRect;
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    if (Math.abs(labelY - lineY) > 1) {
      // A small elbow to the left of the controls links a displaced row to
      // its level without crossing its close button or text.
      ctx.beginPath();
      ctx.moveTo(x + 24, lineY);
      ctx.lineTo(x + 20, lineY);
      ctx.lineTo(x + 20, labelY);
      ctx.lineTo(x + 24, labelY);
      ctx.strokeStyle = target.level === 'sl' ? palette.warn : palette.textLabel;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.stroke();
    }
    const rect = draw(labelY);
    rows.push({ ...target, ...rect, lineY });
    ctx.restore();
  };
  if (layout) {
    layout.pending.push({ target, y: lineY, draw: paint });
  } else {
    paint(lineY);
  }
}
