import { measureTextWidth } from '../textMeasure';

/**
 * Geometry of the countdown tag, laid out in fixed cells.
 *
 * The chart font is proportional, so the library — which sizes a label to its
 * text — would make the tag breathe as the digits change. Every digit is given
 * the widest digit's width and drawn centred in its cell, so a given format
 * (`mm:ss` or `hh:mm:ss`) always occupies the same box with its digits in the
 * same places.
 */

/** The library's label metrics, per 12px of font, so the tag matches the native ones. */
const PADDING_PER_12PX = 5;
const TICK_LENGTH = 5;
const BORDER_SIZE = 1;

const DIGITS = '0123456789';

export interface TagGlyph {
  char: string;
  /** Centre of the glyph's cell, from the axis' left edge. */
  centerX: number;
}

export interface TagLayout {
  /** Box width from the axis' left edge, constant for a given text format. */
  width: number;
  glyphs: readonly TagGlyph[];
}

const digitCells = new Map<string, number>();

/** Width of the widest digit in `font`, measured once per font. */
function digitCellWidth(font: string): number {
  let cell = digitCells.get(font);
  if (cell === undefined) {
    cell = Math.ceil(Math.max(...[...DIGITS].map((digit) => measureTextWidth(digit, font))));
    digitCells.set(font, cell);
  }
  return cell;
}

export function tagLayout(text: string, font: string, fontSize: number): TagLayout {
  const padding = (fontSize / 12) * PADDING_PER_12PX;
  const cell = digitCellWidth(font);
  let x = TICK_LENGTH + padding;
  const glyphs: TagGlyph[] = [];
  for (const char of text) {
    // Separators are never digits, so they cannot change width between seconds.
    const width = DIGITS.includes(char) ? cell : Math.ceil(measureTextWidth(char, font));
    glyphs.push({ char, centerX: x + width / 2 });
    x += width;
  }
  return { width: Math.ceil(x + padding + BORDER_SIZE), glyphs };
}
