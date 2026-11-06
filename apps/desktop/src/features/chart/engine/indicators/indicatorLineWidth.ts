import type { LineWidth } from 'lightweight-charts';

/** The narrowest and widest line the library draws, which every width is clamped to. */
const MIN_LINE_WIDTH = 1;
const MAX_LINE_WIDTH = 4;

/** The library draws only widths 1 to 4, so a plot's or a level's width is rounded into that range. */
export function toLineWidth(width: number): LineWidth {
  if (!Number.isFinite(width)) {
    return MIN_LINE_WIDTH;
  }
  return Math.min(MAX_LINE_WIDTH, Math.max(MIN_LINE_WIDTH, Math.round(width))) as LineWidth;
}
