import { MINUS_SIGN } from './format';

const THOUSAND = 1000;
const UNIT_SUFFIXES = ['K', 'M', 'B'];
/** A K, M or B figure keeps at most this many decimals: 5183 is "5.18 K". */
const SCALED_DECIMALS = 2;
/** A volume under a thousand is written as a whole number: 987.65 is "988". */
const SMALL_VALUE_DECIMALS = 0;
/** What separates a figure from its unit. */
const UNIT_GAP = ' ';

/** `Number` re-prints the text without the zeros `toFixed` pads: "12.50" becomes "12.5". */
function trimmedZeros(text: string): string {
  return String(Number(text));
}

/** The magnitude from a thousand on, in K, M or B with at most 2 decimals, rolling over when rounding reaches 1000. */
function scaledMagnitudeText(magnitude: number): string {
  let unit = 0;
  let scaled = magnitude / THOUSAND;
  while (scaled >= THOUSAND && unit < UNIT_SUFFIXES.length - 1) {
    scaled /= THOUSAND;
    unit += 1;
  }
  let rounded = Number(scaled.toFixed(SCALED_DECIMALS));
  if (rounded >= THOUSAND && unit < UNIT_SUFFIXES.length - 1) {
    rounded = Number((rounded / THOUSAND).toFixed(SCALED_DECIMALS));
    unit += 1;
  }
  return `${rounded}${UNIT_GAP}${UNIT_SUFFIXES[unit]}`;
}

/** The magnitude as a whole number, or scaled once that whole number reaches a thousand (999.999 is "1 K"). */
function magnitudeText(magnitude: number): string {
  const whole = trimmedZeros(magnitude.toFixed(SMALL_VALUE_DECIMALS));
  return Number(whole) < THOUSAND ? whole : scaledMagnitudeText(magnitude);
}

/**
 * A volume in its compact form: under a thousand a whole number, from a thousand on at most
 * 2 decimals and a K, M or B unit after a space (1350 is "1.35 K"). A negative number takes the typographic minus.
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const text = magnitudeText(Math.abs(value));
  return value < 0 && text !== '0' ? `${MINUS_SIGN}${text}` : text;
}
