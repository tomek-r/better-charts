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
 * single-column layout has no sell column: that slot is left empty at the body's left edge, where the candle stands,
 * so the bar still spans its whole body width in the value area and the summary under it.
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

/** How much of the bar's body width the thin candle takes, leaving the columns the rest. */
const CANDLE_WIDTH_SHARE = 0.2;
/** The narrowest a column is ever drawn, in device pixels. */
const NARROWEST_COLUMN = 1;
/** The narrowest a cell band is ever drawn, in device pixels, so a row of no price span still shows. */
const NARROWEST_CELL = 1;
/** The layout of the types holding both sides, which a caller that names no layout gets. */
const TWO_COLUMNS: FootprintLayout = 'two-columns';
/** The size the footprint's numbers are written in, in css px, which the renderer builds its font from. */
export const FOOTPRINT_FONT_SIZE = 10;
/** The height one line of those numbers takes, in css px: a line of the font at FOOTPRINT_FONT_SIZE. */
export const TEXT_LINE_HEIGHT = FOOTPRINT_FONT_SIZE;
/** The room a text needs around it, in css px in all — one css px each side — before a cell or a total writes it. */
export const TEXT_PADDING = 2;

/** The width of the thin candle of a body `fullWidth` device pixels wide. */
function candleWidthOf(fullWidth: number): number {
  return Math.max(NARROWEST_COLUMN, Math.round(fullWidth * CANDLE_WIDTH_SHARE));
}

/** The width of one side column beside a candle `candleWidth` device pixels wide. */
function sideWidthOf(fullWidth: number, candleWidth: number): number {
  return Math.max(NARROWEST_COLUMN, Math.floor((fullWidth - candleWidth) / 2));
}

/** Where the thin candle of a two-column bar starts: centred on the bar's own x, in device pixels. */
function centredCandleLeft(x: number, candleWidth: number, horizontalPixelRatio: number): number {
  return Math.round(x * horizontalPixelRatio) - Math.floor(candleWidth / 2);
}

/**
 * The columns of a two-column bar: a sell column, the thin candle centred on the bar and a buy column, the two sides
 * as wide as each other.
 */
function twoColumnColumns(x: number, fullWidth: number, horizontalPixelRatio: number): FootprintBarColumns {
  const candleWidth = candleWidthOf(fullWidth);
  const sideWidth = sideWidthOf(fullWidth, candleWidth);
  const candleLeft = centredCandleLeft(x, candleWidth, horizontalPixelRatio);
  return {
    sell: { left: candleLeft - sideWidth, width: sideWidth },
    candle: { left: candleLeft, width: candleWidth },
    buy: { left: candleLeft + candleWidth, width: sideWidth },
  };
}

/**
 * The columns of a single-column bar: the thin candle on the body's left edge and the one column right of it, as wide
 * as the two side columns and the candle's old slot in the middle together, which is the body less the candle.
 */
function singleColumnColumns(x: number, fullWidth: number, horizontalPixelRatio: number): FootprintBarColumns {
  const candleWidth = candleWidthOf(fullWidth);
  const bodyLeft = centredCandleLeft(x, candleWidth, horizontalPixelRatio) - sideWidthOf(fullWidth, candleWidth);
  return {
    sell: { left: bodyLeft, width: 0 },
    candle: { left: bodyLeft, width: candleWidth },
    buy: { left: bodyLeft + candleWidth, width: Math.max(NARROWEST_COLUMN, fullWidth - candleWidth) },
  };
}

/**
 * The sell column, the thin candle and the buy column of one bar, spanning `fullWidth` device pixels: the two side
 * columns around a centred candle, or the candle on the body's left edge with the whole column right of it.
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

/** The box one column covers between the media y `topY` and `bottomY`, translated to device pixels. */
export function footprintCellBox(
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

/** Whether a cell writes its text: whether that text fits inside the cell's box. */
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
