/** How many units one K, and one M, of the compact form hold. */
const THOUSAND = 1000;
const MILLION = 1_000_000;
/** The decimals a figure keeps at most, which is what makes "219.51K" out of 219507 and "12.5" out of 12.5. */
const SHOWN_DECIMALS = 2;
/** The smallest volume a cell writes in full: a positive one under it reads as too small to show. */
const SMALLEST_SHOWN_VOLUME = 10 ** -SHOWN_DECIMALS;
/** What a cell writes for a positive volume too small to show, which says how small the volume is. */
const SMALLEST_SHOWN_TEXT = `<${SMALLEST_SHOWN_VOLUME.toFixed(SHOWN_DECIMALS)}`;
/** The units a figure carries, written right after the number with nothing between them. */
const THOUSAND_UNIT = 'K';
const MILLION_UNIT = 'M';
/** What a negative figure is written with. */
const MINUS_SIGN = '−';
/** The zeros a figure's decimals leave behind, and the bare decimal point they would leave with them. */
const TRAILING_ZEROS = /\.?0+$/;

/** A scaled figure without the trailing zeros its decimals leave, and its unit, as "1.59K" out of 1590. */
function scaledText(scaled: number, unit: string): string {
  return `${scaled.toFixed(SHOWN_DECIMALS).replace(TRAILING_ZEROS, '')}${unit}`;
}

/** A volume under a thousand, rounded to the decimals it is written in. */
function roundedLots(volume: number): number {
  return Number(volume.toFixed(SHOWN_DECIMALS));
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
  // The rounded number itself trims the trailing zeros the decimals leave: "12.50" reads "12.5".
  return String(lots);
}

/** A volume the way a footprint cell writes it: at most two decimals, then a K or M unit right after the number. */
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
