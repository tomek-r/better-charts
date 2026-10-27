import { MINUS_SIGN } from './format';

const THOUSAND = 1000;
const UNIT_SUFFIXES = ['', 'K', 'M', 'B'];
const SIGNIFICANT_DIGITS = 3;
const SMALL_VALUE_DECIMALS = 2;

/** `Number` re-prints the text without the zeros `toFixed` and `toPrecision` pad: "12.0" becomes "12". */
function trimmedZeros(text: string): string {
  return String(Number(text));
}

/** The magnitude above a thousand as 3 significant digits and a unit, rolling over when rounding reaches 1000. */
function scaledMagnitudeText(magnitude: number): string {
  let unit = 0;
  let scaled = magnitude;
  while (scaled >= THOUSAND && unit < UNIT_SUFFIXES.length - 1) {
    scaled /= THOUSAND;
    unit += 1;
  }
  let rounded = Number(scaled.toPrecision(SIGNIFICANT_DIGITS));
  if (rounded >= THOUSAND && unit < UNIT_SUFFIXES.length - 1) {
    rounded /= THOUSAND;
    unit += 1;
  }
  return `${rounded}${UNIT_SUFFIXES[unit]}`;
}

/**
 * A volume short enough for a chart label: under a thousand it keeps at most 2 decimals, from a thousand on it
 * is 3 significant digits with a K, M or B unit (1350 is "1.35K"). A negative number takes the typographic minus.
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const magnitude = Math.abs(value);
  const text =
    magnitude < THOUSAND ? trimmedZeros(magnitude.toFixed(SMALL_VALUE_DECIMALS)) : scaledMagnitudeText(magnitude);
  return value < 0 && text !== '0' ? `${MINUS_SIGN}${text}` : text;
}
