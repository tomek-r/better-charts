/**
 * Stored colours are `#rrggbb` (opaque) or `#rrggbbaa`. An opaque colour is always written with six digits,
 * so a colour that never had an alpha channel stores exactly the text it had before alpha existed.
 */

/** One colour as bytes: `alpha` 0 is transparent, 255 opaque. */
export interface RgbaColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

const OPAQUE_ALPHA = 255;
const MAX_PERCENT = 100;
const HEX_COLOR_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i;

/** The bytes of a `#rrggbb` or `#rrggbbaa` text; undefined for any other text. */
export function parseHexColor(text: string): RgbaColor | undefined {
  const match = HEX_COLOR_PATTERN.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, red, green, blue, alpha] = match;
  return {
    red: parseInt(red, 16),
    green: parseInt(green, 16),
    blue: parseInt(blue, 16),
    alpha: alpha === undefined ? OPAQUE_ALPHA : parseInt(alpha, 16),
  };
}

function byteText(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/** `#rrggbb` while the colour is opaque, `#rrggbbaa` otherwise; always lower case. */
export function formatHexColor({ red, green, blue, alpha }: RgbaColor): string {
  const solid = `#${byteText(red)}${byteText(green)}${byteText(blue)}`;
  return alpha === OPAQUE_ALPHA ? solid : `${solid}${byteText(alpha)}`;
}

/** The alpha byte of an opacity in percent; out-of-range percents are clamped to 0..100. */
export function opacityPercentToAlpha(percent: number): number {
  const clamped = Math.min(MAX_PERCENT, Math.max(0, percent));
  return Math.round((clamped * OPAQUE_ALPHA) / MAX_PERCENT);
}

/** The opacity in whole percent of an alpha byte. */
export function alphaToOpacityPercent(alpha: number): number {
  return Math.round((alpha * MAX_PERCENT) / OPAQUE_ALPHA);
}

/** The colour without its alpha: `#rrggbb`. Text that is no colour comes back unchanged. */
export function solidHexColor(text: string): string {
  const parsed = parseHexColor(text);
  return parsed === undefined ? text : formatHexColor({ ...parsed, alpha: OPAQUE_ALPHA });
}

/** The opacity in percent of a stored colour; an unreadable text counts as opaque. */
export function colorOpacityPercent(text: string): number {
  const parsed = parseHexColor(text);
  return alphaToOpacityPercent(parsed?.alpha ?? OPAQUE_ALPHA);
}

/** Whether the text is a colour with alpha 00, which paints nothing. */
export function isFullyTransparent(text: string): boolean {
  return parseHexColor(text)?.alpha === 0;
}

/** The same colour at another opacity; text that is no colour comes back unchanged. */
export function withOpacityPercent(text: string, percent: number): string {
  const parsed = parseHexColor(text);
  return parsed === undefined ? text : formatHexColor({ ...parsed, alpha: opacityPercentToAlpha(percent) });
}

/** The same colour with the alpha another colour carries, so a new colour keeps the opacity chosen so far. */
export function withAlphaOf(text: string, alphaSource: string): string {
  const parsed = parseHexColor(text);
  const source = parseHexColor(alphaSource);
  return parsed === undefined ? text : formatHexColor({ ...parsed, alpha: source?.alpha ?? OPAQUE_ALPHA });
}

/** A colour moved `amount` (0..1) of the way toward another, ignoring alpha: tints toward white, shades toward black. */
export function mixHexColors(base: string, toward: string, amount: number): string {
  const from = parseHexColor(base);
  const to = parseHexColor(toward);
  if (from === undefined || to === undefined) {
    return base;
  }
  const blend = (start: number, end: number) => Math.round(start + (end - start) * amount);
  return formatHexColor({
    red: blend(from.red, to.red),
    green: blend(from.green, to.green),
    blue: blend(from.blue, to.blue),
    alpha: OPAQUE_ALPHA,
  });
}
