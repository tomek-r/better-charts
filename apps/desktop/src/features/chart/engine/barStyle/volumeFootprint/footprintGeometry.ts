import type { DevicePixelRatios } from '../barBodyWidth';
import type { FootprintLayout } from './footprintModes';
import type { FootprintSide } from './footprintShades';

/** A vertical strip of a footprint bar, in device pixels: where it starts and how wide it is. */
export interface FootprintColumn {
  readonly left: number;
  readonly width: number;
}

/**
 * Where the sell column, the thin candle and the buy column of one bar sit, in device pixels. A bar drawn in the
 * single-column layout has no sell column: that slot is left empty at the group's left edge, where the candle stands,
 * and the one column right of it holds the bar's cells, its totals and the summary box under them. The groups of both
 * layouts are centred on the bar's x and their columns never grow past MAX_COLUMN_WIDTH, so a wide body keeps empty
 * background either side of them rather than fatter columns.
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

/** How wide a text is, in css px, in the font the footprint writes its numbers in. */
export type FootprintTextWidth = (text: string) => number;

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
/** The size the footprint's numbers are written in, in css px, which the renderer builds its font from. */
export const FOOTPRINT_FONT_SIZE = 14;
/** The height one line of those numbers takes, in css px: a line of the font at FOOTPRINT_FONT_SIZE. */
export const TEXT_LINE_HEIGHT = FOOTPRINT_FONT_SIZE;
/** The room a text keeps from the edge it stands against, in css px, on either side of the thin candle. */
export const TEXT_PADDING = 8;
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
 * device pixel, less half the box's width, which is where the columns, gaps and candle of a bar begin.
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
 * The columns of a single-column bar: the thin candle on the group's left edge, a gap, and the one column the bar's
 * cells and its totals are written in, capped like the columns of the two-column layout.
 */
function singleColumnColumns(x: number, fullWidth: number, horizontalPixelRatio: number): FootprintBarColumns {
  const candleWidth = candleWidthOf(fullWidth);
  const gap = candleGapOf(fullWidth, candleWidth, horizontalPixelRatio);
  const columnWidth = columnWidthOf(fullWidth - candleWidth - gap, horizontalPixelRatio);
  const left = centredLeftOf(x, candleWidth + gap + columnWidth, horizontalPixelRatio);
  return {
    sell: { left, width: 0 },
    candle: { left, width: candleWidth },
    buy: { left: left + candleWidth + gap, width: columnWidth },
  };
}

/**
 * The sell column, the thin candle and the buy column of one bar, spanning `fullWidth` device pixels: the two side
 * columns with a gap either side of a candle between them, or the candle on the group's left edge with the one
 * column right of it. Each column is at most MAX_COLUMN_WIDTH wide and the group they make is centred on the bar's x.
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
 * Whether `text` fits a box `width` by `height` device pixels: the text and its padding no wider than the box's media
 * width, and the box at least one line of the font tall. `textWidth` measures the text in css px, so this needs no
 * canvas to decide.
 */
export function footprintTextFits(
  width: number,
  height: number,
  text: string,
  ratios: DevicePixelRatios,
  textWidth: FootprintTextWidth,
): boolean {
  if (height / ratios.verticalPixelRatio < TEXT_LINE_HEIGHT) {
    return false;
  }
  return textWidth(text) + TEXT_PADDING <= width / ratios.horizontalPixelRatio;
}

/** Whether a cell writes its text: whether that text fits inside the cell's box, which is its row less the gap. */
export function footprintCellShowsText(
  box: FootprintCellBox,
  text: string,
  ratios: DevicePixelRatios,
  textWidth: FootprintTextWidth,
): boolean {
  return footprintTextFits(box.width, box.height, text, ratios, textWidth);
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

/** The media x a text of `align` is written at inside `column`, TEXT_PADDING css px in from the edge it stands on. */
export function footprintTextX(
  column: FootprintColumn,
  align: FootprintTextAlign,
  horizontalPixelRatio: number,
): number {
  if (align === 'right') {
    return (column.left + column.width) / horizontalPixelRatio - TEXT_PADDING;
  }
  return column.left / horizontalPixelRatio + TEXT_PADDING;
}
