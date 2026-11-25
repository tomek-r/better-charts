/** How many units one K, and one M, of the compact form hold. */
const THOUSAND = 1000;
const MILLION = 1_000_000;
/** The decimals a K or M figure keeps, which is what makes "219.507 K" out of 219507. */
const SCALED_DECIMALS = 3;
/** The decimals a volume under a thousand keeps, as fine as a fractional lot is traded. */
const LOT_DECIMALS = 3;
/** The smallest volume a cell can write in full: anything under it rounds away at those decimals. */
const SMALLEST_SHOWN_VOLUME = 10 ** -LOT_DECIMALS;
/** What a cell writes for a positive volume too small to show, which says how small the volume is. */
const SMALLEST_SHOWN_TEXT = `<${SMALLEST_SHOWN_VOLUME.toFixed(LOT_DECIMALS)}`;
/** The units a figure carries, each after the gap that separates it from the number. */
const THOUSAND_UNIT = 'K';
const MILLION_UNIT = 'M';
/** What separates a figure from its unit. */
const UNIT_GAP = ' ';
/** What a negative figure is written with. */
const MINUS_SIGN = '−';
/** The zeros a scaled figure's decimals leave behind, and the bare decimal point they would leave with them. */
const TRAILING_ZEROS = /\.?0+$/;

/** A scaled figure without the trailing zeros its decimals leave, and its unit, as "1.59 K" out of 1590. */
function scaledText(scaled: number, unit: string): string {
  return `${scaled.toFixed(SCALED_DECIMALS).replace(TRAILING_ZEROS, '')}${UNIT_GAP}${unit}`;
}

/** A volume under a thousand, rounded to the decimals it is written in. */
function roundedLots(volume: number): number {
  return Number(volume.toFixed(LOT_DECIMALS));
}

/** A volume below a thousand as its own decimals, or as the K form when those decimals round it up to one. */
function belowThousandText(volume: number): string {
  const lots = roundedLots(volume);
  if (lots >= THOUSAND) {
    return scaledText(volume / THOUSAND, THOUSAND_UNIT);
  }
  if (lots < SMALLEST_SHOWN_VOLUME) {
    return SMALLEST_SHOWN_TEXT;
  }
  // The rounded number itself trims the trailing zeros the decimals leave: "12.500" reads "12.5".
  return String(lots);
}

/** A volume the way a footprint cell writes it: at most three decimals below a thousand, then a K or M unit. */
export function footprintVolumeText(volume: number): string {
  if (!(volume > 0)) {
    return '0';
  }
  if (volume >= MILLION) {
    return scaledText(volume / MILLION, MILLION_UNIT);
  }
  if (volume >= THOUSAND) {
    return scaledText(volume / THOUSAND, THOUSAND_UNIT);
  }
  return belowThousandText(volume);
}

/** A figure the way a cell writes it when it can point either way: with a leading minus sign while it is negative. */
export function footprintSignedText(value: number): string {
  if (value < 0) {
    return `${MINUS_SIGN}${footprintVolumeText(-value)}`;
  }
  return footprintVolumeText(value);
}
