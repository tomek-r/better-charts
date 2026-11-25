import type { DevicePixelRatios } from '../barBodyWidth';
import type { FootprintCellBox, FootprintColumn, FootprintTextAlign } from './footprintGeometry';

/** How wide a text is, in css px, in the font the footprint writes its numbers in at FOOTPRINT_FONT_SIZE. */
export type FootprintTextWidth = (text: string) => number;

/** The largest size a bar's numbers are written in, in css px, which every text is measured at. */
export const FOOTPRINT_FONT_SIZE = 14;
/** The height one line of those numbers takes at FOOTPRINT_FONT_SIZE, in css px: a line of the font at that size. */
export const TEXT_LINE_HEIGHT = FOOTPRINT_FONT_SIZE;
/** The room a text keeps from the edge it stands against at FOOTPRINT_FONT_SIZE, in css px. */
export const TEXT_PADDING = 8;
/**
 * The smallest size a bar's numbers are written in, in css px: a bar whose rows hold no line of this size writes no
 * number at all, rather than one too small to read.
 */
export const MIN_FOOTPRINT_FONT_SIZE = 8;
/** The narrowest room a text is ever kept from the edge it stands against, in css px, however small its size. */
const NARROWEST_TEXT_PADDING = 2;

/**
 * What one bar's texts are laid out with: the one size every number of the bar is written in, the screen's ratios,
 * and the seam that measures a text at FOOTPRINT_FONT_SIZE, which every smaller size scales.
 */
export interface FootprintTextStyle extends DevicePixelRatios {
  readonly size: number;
  readonly textWidth: FootprintTextWidth;
}

/** How much shorter every length the style writes is at `size` than at FOOTPRINT_FONT_SIZE. */
export function footprintTextScale(size: number): number {
  return size / FOOTPRINT_FONT_SIZE;
}

/** The height one line of the numbers at `size` takes, in css px: a line of the font drawn at that size. */
export function footprintLineHeight(size: number): number {
  return size;
}

/** How far a text at `size` stands from the edge it is aligned on, in css px: TEXT_PADDING at the maximum size. */
export function footprintTextPadding(size: number): number {
  return Math.max(NARROWEST_TEXT_PADDING, TEXT_PADDING * footprintTextScale(size));
}

/**
 * The largest whole css px size from FOOTPRINT_FONT_SIZE down to MIN_FOOTPRINT_FONT_SIZE that a line of it fits a row
 * `rowHeight` css px tall, or null while even the smallest size does not fit.
 */
export function footprintTextSize(rowHeight: number): number | null {
  const wholeHeight = Math.floor(rowHeight);
  if (wholeHeight < MIN_FOOTPRINT_FONT_SIZE) {
    return null;
  }
  return Math.min(FOOTPRINT_FONT_SIZE, wholeHeight);
}

/**
 * The one size a whole bar writes its numbers in: the largest that fits the shortest of its cells' boxes,
 * `cellHeights` device pixels tall, or null while the bar holds no cell or no row tall enough for the smallest size.
 */
export function footprintBarTextSize(cellHeights: readonly number[], verticalPixelRatio: number): number | null {
  if (cellHeights.length === 0) {
    return null;
  }
  return footprintTextSize(Math.min(...cellHeights) / verticalPixelRatio);
}

/** How wide `text` is at `style`'s size, in css px: the width it measures at the maximum size, scaled. */
export function footprintTextWidthAt(text: string, style: FootprintTextStyle): number {
  return style.textWidth(text) * footprintTextScale(style.size);
}

/**
 * Whether `text` fits a box `width` by `height` device pixels while written at `style`'s size: a line of that size no
 * taller than the box's media height, and the text with the padding it keeps from its edge no wider than its media
 * width. The text is measured once at FOOTPRINT_FONT_SIZE, so no canvas is built per size.
 */
export function footprintTextFits(
  box: Pick<FootprintCellBox, 'width' | 'height'>,
  text: string,
  style: FootprintTextStyle,
): boolean {
  if (box.height / style.verticalPixelRatio < footprintLineHeight(style.size)) {
    return false;
  }
  const room = footprintTextWidthAt(text, style) + footprintTextPadding(style.size);
  return room <= box.width / style.horizontalPixelRatio;
}

/**
 * Whether a cell writes its text: whether that text fits its own row's height and the width of the whole column the
 * cell stands in, `columnWidth` device pixels. In Profile a cell's coloured box is only its share of the column, so
 * its number may run past the coloured part onto the column's background and still be written; a number the whole
 * column cannot hold is left out.
 */
export function footprintCellShowsText(
  box: FootprintCellBox,
  columnWidth: number,
  text: string,
  style: FootprintTextStyle,
): boolean {
  return footprintTextFits({ width: columnWidth, height: box.height }, text, style);
}

/** The media x a text of `align` is written at inside `column`, its own padding in from the edge it stands on. */
export function footprintTextX(column: FootprintColumn, align: FootprintTextAlign, style: FootprintTextStyle): number {
  const padding = footprintTextPadding(style.size);
  if (align === 'right') {
    return (column.left + column.width) / style.horizontalPixelRatio - padding;
  }
  return column.left / style.horizontalPixelRatio + padding;
}
