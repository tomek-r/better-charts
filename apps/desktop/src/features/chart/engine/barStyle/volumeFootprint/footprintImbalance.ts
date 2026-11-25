import type { FootprintImbalanceHighlight } from '../barStyleAppearance';
import type { FootprintCellBox } from './footprintGeometry';
import type { FootprintSide } from './footprintShades';

/** The width an imbalance mark is drawn at, in host CSS px. */
export const IMBALANCE_MARK_WIDTH = 3;
/** The narrowest an imbalance mark is ever drawn, in device pixels, so it stays visible on any screen. */
const NARROWEST_MARK = 1;

/** The colour the mark of `side`'s imbalanced cells is drawn in. */
export function imbalanceMarkColor(highlight: FootprintImbalanceHighlight, side: FootprintSide): string {
  return side === 'sell' ? highlight.sellColor : highlight.buyColor;
}

/** How many device pixels wide an imbalance mark is at `horizontalPixelRatio`. */
export function imbalanceMarkWidth(horizontalPixelRatio: number): number {
  return Math.max(NARROWEST_MARK, Math.round(IMBALANCE_MARK_WIDTH * horizontalPixelRatio));
}

/**
 * The box the imbalance mark of one cell covers, in device pixels: a short solid bar standing on the cell's
 * outer edge — the left edge of a sell cell, the right edge of a buy one — as tall as the row itself.
 */
export function footprintImbalanceBox(
  cell: FootprintCellBox,
  side: FootprintSide,
  horizontalPixelRatio: number,
): FootprintCellBox {
  const width = imbalanceMarkWidth(horizontalPixelRatio);
  return {
    left: side === 'sell' ? cell.left : cell.left + cell.width - width,
    width,
    top: cell.top,
    height: cell.height,
  };
}
