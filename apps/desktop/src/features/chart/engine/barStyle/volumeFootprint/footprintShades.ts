import { parseHexColor } from '../../../../../shared/theme/hexColor';
import { palette } from '../../../../../shared/theme/palette';

/** The two sides a bar's volume trades on, each drawn in a column of its own. */
export const FOOTPRINT_SIDES = ['sell', 'buy'] as const;

export type FootprintSide = (typeof FOOTPRINT_SIDES)[number];

/**
 * The fill of a cell with no side to shade — a ladder's smaller side, a delta that points nowhere: the chart's quiet
 * raised surface, so the cell still reads as a cell against the pane.
 */
export const FOOTPRINT_NEUTRAL_COLOR = palette.raised;

/** The shade the row a bar traded most at is drawn in on both sides, which a dark chart reads as white. */
export const FOOTPRINT_POC_COLOR = '#ffffff';
/** The text on a light shade and on a dark one. */
const DARK_TEXT_COLOR = '#0b0e14';
const LIGHT_TEXT_COLOR = '#ffffff';
/** How bright a fill must be before dark text reads on it, from 0 (black) to 1 (white). */
const DARK_TEXT_BRIGHTNESS = 0.55;
/** The share each channel takes of a fill's perceived brightness, and the value of a full one. */
const RED_SHARE = 0.299;
const GREEN_SHARE = 0.587;
const BLUE_SHARE = 0.114;
const FULL_BYTE = 255;
/** The band every cell of a side takes while the gradient is off: the middle of that side's ramp. */
const FLAT_BAND = 2;

/** The step of a side's ramp a cell is drawn in: 1 is the lightest, 4 the darkest. */
export type FootprintBand = 1 | 2 | 3 | 4;

/** The share of the side's value range each band starts at: the lightest holds the first quarter. */
const BAND_STARTS: readonly number[] = [0.25, 0.5, 0.75];

/** The values one column of a bar traded between, which that column's cells are graded between. */
export interface FootprintVolumeRange {
  readonly min: number;
  readonly max: number;
}

/** The range one bar's cells are graded from nothing up to its largest value of a kind. */
export function footprintRangeFromZero(largest: number): FootprintVolumeRange {
  return { min: 0, max: largest };
}

/**
 * The band `value` falls in, as the share of the way it sits from the quietest cell of its range towards the
 * busiest. A range that spans nothing, all of its cells trading alike, puts every one of them in the lightest band.
 */
export function footprintBand(value: number, range: FootprintVolumeRange): FootprintBand {
  const spread = range.max - range.min;
  if (spread <= 0) {
    return 1;
  }
  const share = (value - range.min) / spread;
  if (share < BAND_STARTS[0]) {
    return 1;
  }
  if (share < BAND_STARTS[1]) {
    return 2;
  }
  if (share < BAND_STARTS[2]) {
    return 3;
  }
  return 4;
}

/**
 * The band one cell is drawn in, which both its fill and its text colour come from: the band its value is graded
 * to, or the flat one while the gradient is off.
 */
export function footprintCellBand(value: number, range: FootprintVolumeRange, gradient: boolean): FootprintBand {
  return gradient ? footprintBand(value, range) : FLAT_BAND;
}

/** The colour of one band of a side's ramp, which the settings hold four shades of, lightest first. */
export function footprintShadeColor(shades: readonly string[], band: FootprintBand): string {
  return shades[band - 1];
}

/** The colour a cell's number takes on its shade: white on the dark shades, dark on the light ones. */
export function footprintTextColor(band: FootprintBand): string {
  return band >= 3 ? LIGHT_TEXT_COLOR : DARK_TEXT_COLOR;
}

/**
 * The colour text takes on `fill`, which a cell drawn in a colour of its own is written in: dark on a light fill,
 * light on a dark one, and light on text that is no colour at all.
 */
export function footprintTextOn(fill: string): string {
  const parsed = parseHexColor(fill);
  if (parsed === undefined) {
    return LIGHT_TEXT_COLOR;
  }
  const brightness = (RED_SHARE * parsed.red + GREEN_SHARE * parsed.green + BLUE_SHARE * parsed.blue) / FULL_BYTE;
  return brightness >= DARK_TEXT_BRIGHTNESS ? DARK_TEXT_COLOR : LIGHT_TEXT_COLOR;
}

/** The colour a number written on the neutral fill takes, which no cell has a side to pick it from. */
export const FOOTPRINT_NEUTRAL_TEXT_COLOR = footprintTextOn(FOOTPRINT_NEUTRAL_COLOR);
