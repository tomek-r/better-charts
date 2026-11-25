import type { FootprintLayout } from './footprintModes';
import type { FootprintSide } from './footprintShades';

/** A vertical strip of a footprint bar, in device pixels: where it starts and how wide it is. */
export interface FootprintColumn {
  readonly left: number;
  readonly width: number;
}

/**
 * Where the sell column, the thin candle and the buy column of one bar sit, in device pixels. Both layouts keep the
 * thin candle on the bar's own x, which is the grid line the chart draws the bar on: in the two-column layout it
 * stands between the two columns, whose group is centred there, and in the single-column layout the candle is itself
 * centred there, with a gap and the one column right of it. A single-column bar therefore has no sell column: that
 * slot is left empty where the candle stands, and the one column holds the bar's cells, its totals and the summary box
 * under them. Every column is held at MAX_COLUMN_WIDTH, so a wide body keeps empty background beside the group rather
 * than fatter columns.
 */
export interface FootprintBarColumns {
  readonly sell: FootprintColumn;
  readonly candle: FootprintColumn;
  readonly buy: FootprintColumn;
}

/** The box one column covers between two prices, in device pixels. */
export interface FootprintCellBox extends FootprintColumn {
  readonly top: number;
  readonly height: number;
}

/** How a text is aligned on the media x it is written at: a column's numbers stand on one of its two edges. */
export type FootprintTextAlign = 'left' | 'right';

/** How much of the bar's body width the thin candle takes, leaving the columns the rest. */
const CANDLE_WIDTH_SHARE = 0.15;
/** The empty background left either side of the thin candle, in css px, so the candle stands free of its columns. */
const CANDLE_GAP = 6;
/** The narrowest a column is ever drawn, in device pixels. */
const NARROWEST_COLUMN = 1;
/**
 * The widest a column is ever drawn, in css px, however wide a body the user zooms the chart to: the room a wider
 * body leaves beside its columns stays empty background instead of making the columns fatter.
 */
export const MAX_COLUMN_WIDTH = 72;
/** The narrowest a cell band is ever drawn, in device pixels, so a row of no price span still shows. */
const NARROWEST_CELL = 1;
/** The parts the room beside a candle is split into, so a gap never takes more than a quarter of it. */
const ROOM_PARTS = 4;
/** The layout of the types holding both sides, which a caller that names no layout gets. */
const TWO_COLUMNS: FootprintLayout = 'two-columns';
/** The empty background a cell keeps under itself, in css px, so the cells of two neighbouring rows never touch. */
export const ROW_GAP = 2;
/**
 * The side whose column a single-column bar fills: the buy column, right of the thin candle. The two types that
 * write one cell a row write it there, and it reads as that side's column.
 */
export const SINGLE_COLUMN_SIDE: FootprintSide = 'buy';

/** The width of the thin candle of a body `fullWidth` device pixels wide. */
function candleWidthOf(fullWidth: number): number {
  return Math.max(NARROWEST_COLUMN, Math.round(fullWidth * CANDLE_WIDTH_SHARE));
}

/**
 * The empty background either side of the candle, in device pixels: CANDLE_GAP css px at the screen's ratio, cut
 * down while the body has no room for that gap and a column as wide as it on both sides of the candle.
 */
function candleGapOf(fullWidth: number, candleWidth: number, horizontalPixelRatio: number): number {
  const room = Math.max(0, fullWidth - candleWidth);
  return Math.max(0, Math.min(Math.round(CANDLE_GAP * horizontalPixelRatio), Math.floor(room / ROOM_PARTS)));
}

/**
 * The left edge of a box `width` device pixels wide centred on the bar's media x `x`: the bar's own x snapped to a
 * device pixel, less half the box's width. It places the group of a two-column bar and the candle of a single-column
 * one, both of which stand centred on the bar's x.
 */
function centredLeftOf(x: number, width: number, horizontalPixelRatio: number): number {
  return Math.round(x * horizontalPixelRatio) - Math.floor(width / 2);
}

/**
 * The width a column is drawn at: its share of the room beside the candle and its gaps, in device pixels, held
 * between NARROWEST_COLUMN and MAX_COLUMN_WIDTH css px at the screen's ratio.
 */
function columnWidthOf(share: number, horizontalPixelRatio: number): number {
  const widest = Math.round(MAX_COLUMN_WIDTH * horizontalPixelRatio);
  return Math.max(NARROWEST_COLUMN, Math.min(share, widest));
}

/**
 * The columns of a two-column bar, left to right: the sell column, a gap, the thin candle between them, another gap
 * and the buy column. The room beside the candle is split into the two columns, each held at MAX_COLUMN_WIDTH, and
 * the gaps and columns are centred on the bar's x, so a body wider than they fill keeps empty background either side.
 */
function twoColumnColumns(x: number, fullWidth: number, horizontalPixelRatio: number): FootprintBarColumns {
  const candleWidth = candleWidthOf(fullWidth);
  const gap = candleGapOf(fullWidth, candleWidth, horizontalPixelRatio);
  const room = fullWidth - candleWidth - 2 * gap;
  const sellShare = Math.floor(room / 2);
  const sellWidth = columnWidthOf(sellShare, horizontalPixelRatio);
  // The buy column keeps the odd pixel of the split, so a body the caps do not narrow still fills exactly.
  const buyWidth = columnWidthOf(room - sellShare, horizontalPixelRatio);
  const left = centredLeftOf(x, sellWidth + gap + candleWidth + gap + buyWidth, horizontalPixelRatio);
  const candleLeft = left + sellWidth + gap;
  return {
    sell: { left, width: sellWidth },
    candle: { left: candleLeft, width: candleWidth },
    buy: { left: candleLeft + candleWidth + gap, width: buyWidth },
  };
}

/**
 * The columns of a single-column bar: the thin candle centred on the bar's own x, so it stands on the vertical grid
 * line the chart draws the bar on, a gap right of it, and the one column the bar's cells, its totals and its summary
 * are written in, capped like the columns of the two-column layout. The candle therefore stands where a two-column
 * bar keeps its own, and the gap and the column reach right of it rather than the group being centred on the bar's x.
 */
function singleColumnColumns(x: number, fullWidth: number, horizontalPixelRatio: number): FootprintBarColumns {
  const candleWidth = candleWidthOf(fullWidth);
  const gap = candleGapOf(fullWidth, candleWidth, horizontalPixelRatio);
  const columnWidth = columnWidthOf(fullWidth - candleWidth - gap, horizontalPixelRatio);
  const candleLeft = centredLeftOf(x, candleWidth, horizontalPixelRatio);
  return {
    sell: { left: candleLeft, width: 0 },
    candle: { left: candleLeft, width: candleWidth },
    buy: { left: candleLeft + candleWidth + gap, width: columnWidth },
  };
}

/**
 * The sell column, the thin candle and the buy column of one bar, spanning `fullWidth` device pixels: the two side
 * columns with a gap either side of a candle between them, or the candle centred on the bar's x with a gap and the one
 * column right of it. Each column is at most MAX_COLUMN_WIDTH wide.
 */
export function footprintBarColumns(
  x: number,
  fullWidth: number,
  horizontalPixelRatio: number,
  layout: FootprintLayout = TWO_COLUMNS,
): FootprintBarColumns {
  return layout === 'single-column'
    ? singleColumnColumns(x, fullWidth, horizontalPixelRatio)
    : twoColumnColumns(x, fullWidth, horizontalPixelRatio);
}

/**
 * The empty background between the column one side's cells fill and the thin candle, in device pixels: the gap the
 * layout leaves beside the candle on that side, where that side's imbalance marks stand. A single-column bar keeps no
 * sell column, so only the gap before its one buy column holds anything.
 */
export function footprintInnerGap(columns: FootprintBarColumns, side: FootprintSide): number {
  if (side === 'sell') {
    return Math.max(0, columns.candle.left - (columns.sell.left + columns.sell.width));
  }
  return Math.max(0, columns.buy.left - (columns.candle.left + columns.candle.width));
}

/**
 * The candle of a bar that draws no cells, as the pane paints it: the media x its body is centred on and the device
 * width that body takes.
 */
export interface FootprintCandleGlyph {
  readonly x: number;
  readonly width: number;
}

/**
 * The candle of a bar the host holds no footprint for: the very column the thin candle of a footprint bar at the same
 * x and body width takes, read as the media x to paint it on and the device width to paint it at. A bar still being
 * read therefore lines up with the footprint bars beside it instead of taking its whole body width.
 */
export function footprintCandleGlyph(candle: FootprintColumn, horizontalPixelRatio: number): FootprintCandleGlyph {
  return { x: (candle.left + candle.width / 2) / horizontalPixelRatio, width: candle.width };
}

/** The empty background a cell leaves under itself, in device pixels: ROW_GAP css px at the screen's ratio. */
function rowGapPixels(verticalPixelRatio: number): number {
  return Math.round(ROW_GAP * verticalPixelRatio);
}

/** The whole box one column covers between the media y `topY` and `bottomY`, translated to device pixels. */
export function footprintRowBox(
  column: FootprintColumn,
  topY: number,
  bottomY: number,
  verticalPixelRatio: number,
): FootprintCellBox {
  const top = Math.round(topY * verticalPixelRatio);
  const height = Math.max(NARROWEST_CELL, Math.round(bottomY * verticalPixelRatio) - top);
  return { left: column.left, width: column.width, top, height };
}

/**
 * A box shortened by the row gap at its bottom, its top edge unchanged, so the cells of two neighbouring rows leave
 * that much background between them. A row too short to keep a device pixel after the gap keeps one.
 */
export function footprintRowGapBox(box: FootprintCellBox, verticalPixelRatio: number): FootprintCellBox {
  return { ...box, height: Math.max(NARROWEST_CELL, box.height - rowGapPixels(verticalPixelRatio)) };
}

/** The box one cell covers between the two prices of its row: its column's whole box, less the gap under it. */
export function footprintCellBox(
  column: FootprintColumn,
  topY: number,
  bottomY: number,
  verticalPixelRatio: number,
): FootprintCellBox {
  return footprintRowGapBox(footprintRowBox(column, topY, bottomY, verticalPixelRatio), verticalPixelRatio);
}

/**
 * The box of a profile cell: `widthShare` of its column's width, kept on the edge nearest the thin candle, so the
 * cells of a bar grow away from it as their values do. The single column of a one-column bar is a buy column, so its
 * cells are anchored at its left, next to the candle.
 */
export function footprintProfileBox(box: FootprintCellBox, widthShare: number, side: FootprintSide): FootprintCellBox {
  const width = Math.max(NARROWEST_CELL, Math.round(box.width * widthShare));
  if (side === 'buy') {
    return { ...box, width };
  }
  return { ...box, left: box.left + box.width - width, width };
}

/** How a column writes its text: on the edge nearest the thin candle, the sell column's right and the buy's left. */
export function footprintTextAlignOf(side: FootprintSide): FootprintTextAlign {
  return side === 'sell' ? 'right' : 'left';
}
