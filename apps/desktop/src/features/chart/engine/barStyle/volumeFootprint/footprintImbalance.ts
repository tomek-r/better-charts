import type { FootprintImbalanceHighlight } from '../barStyleAppearance';
import type { FootprintCellBox } from './footprintGeometry';
import type { FootprintSide } from './footprintShades';

/** The width an imbalance mark is drawn at, in host CSS px. */
export const IMBALANCE_MARK_WIDTH = 3;
/** The empty background a mark keeps between itself and the inner edge of its own column, in host CSS px. */
export const IMBALANCE_MARK_SPACE = 1;
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

/** How many device pixels of background a mark keeps between itself and its column's inner edge. */
function imbalanceMarkSpace(horizontalPixelRatio: number): number {
  return Math.max(0, Math.round(IMBALANCE_MARK_SPACE * horizontalPixelRatio));
}

/**
 * The width the mark of one cell is drawn at: the width it always takes, shrunk to what the gap it stands in still
 * holds once its own space is kept beside it, and never narrower than one device pixel.
 */
function markWidthInGap(gap: number, horizontalPixelRatio: number): number {
  const room = gap - imbalanceMarkSpace(horizontalPixelRatio);
  return Math.max(NARROWEST_MARK, Math.min(imbalanceMarkWidth(horizontalPixelRatio), room));
}

/**
 * The box the imbalance mark of one cell covers, in device pixels: a short solid bar standing in the empty background
 * between the cell's column and the thin candle — just right of a sell column's right edge, just left of a buy
 * column's left one — with IMBALANCE_MARK_SPACE css px of that background kept between it and the column. `gap` is the
 * whole of the background the layout leaves there, which the mark is shrunk to fit rather than covering the candle.
 * The mark is as tall as the cell's own box, so it stops a row gap above the row below it, where the cell's fill stops.
 */
export function footprintImbalanceBox(
  cell: FootprintCellBox,
  side: FootprintSide,
  gap: number,
  horizontalPixelRatio: number,
): FootprintCellBox {
  const space = imbalanceMarkSpace(horizontalPixelRatio);
  const width = markWidthInGap(gap, horizontalPixelRatio);
  return {
    left: side === 'sell' ? cell.left + cell.width + space : cell.left - space - width,
    width,
    top: cell.top,
    height: cell.height,
  };
}
