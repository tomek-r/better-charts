import type { TradingLabelHit } from './tradingLabelTypes';

/** Whether a pane point falls inside a painted label's rectangle. */
export function containsLabel(row: TradingLabelHit, x: number, y: number): boolean {
  return x >= row.x && x <= row.x + row.w && y >= row.y && y <= row.y + row.h;
}
