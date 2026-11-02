/**
 * The colour space of the custom-colour editor: HSV, its hue in degrees 0..360 (0 is red), its saturation
 * and its value in 0..1. Stored colours are hex, so converting between the two happens only here.
 */

export interface HsvColor {
  readonly hue: number;
  readonly saturation: number;
  readonly value: number;
}

const HUE_CIRCLE = 360;
const HUE_SECTORS = 6;
const HUE_PER_SECTOR = HUE_CIRCLE / HUE_SECTORS;
const BYTE_MAX = 255;
const SOLID_DIGITS = 6;
const SHORT_HEX_PATTERN = /^[0-9a-f]{3,4}$/;
const SOLID_HEX_PATTERN = /^[0-9a-f]{6}$/;
const WITH_ALPHA_HEX_PATTERN = /^[0-9a-f]{8}$/;
const HASH_PREFIX = /^#/;

/** The number kept inside 0..1. */
export function clampUnit(number: number): number {
  return Math.min(1, Math.max(0, number));
}

/** The hue kept inside 0..360, both ends of the wheel being red. */
export function clampHue(hue: number): number {
  return Math.min(HUE_CIRCLE, Math.max(0, hue));
}

/** The hue moved onto the 0..360 wheel: a value outside it wraps around. */
function wrapHue(hue: number): number {
  return ((hue % HUE_CIRCLE) + HUE_CIRCLE) % HUE_CIRCLE;
}

/**
 * The `#rrggbb` of a hex text, in lower case: `#rgb` and `#rgba` shorthand is expanded and an alpha suffix is
 * dropped, so a colour with opacity reads as its solid form. Undefined for text that is no colour.
 */
export function readHexInput(text: string): string | undefined {
  const digits = text.trim().replace(HASH_PREFIX, '').toLowerCase();
  const full = SHORT_HEX_PATTERN.test(digits) ? Array.from(digits, (digit) => digit + digit).join('') : digits;
  if (SOLID_HEX_PATTERN.test(full)) {
    return `#${full}`;
  }
  return WITH_ALPHA_HEX_PATTERN.test(full) ? `#${full.slice(0, SOLID_DIGITS)}` : undefined;
}

/** One channel's byte: `quarterTurns` names the channel, 5 red, 3 green and 1 blue. */
function channelByte(hue: number, saturation: number, value: number, quarterTurns: number): number {
  const sector = (quarterTurns + wrapHue(hue) / HUE_PER_SECTOR) % HUE_SECTORS;
  const triangle = Math.max(0, Math.min(sector, HUE_SECTORS - 2 - sector, 1));
  const level = clampUnit(value) - clampUnit(saturation) * clampUnit(value) * triangle;
  return Math.round(level * BYTE_MAX);
}

function byteText(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/** The colour of a hue, saturation and value as `#rrggbb` in lower case. */
export function hsvToHex(hue: number, saturation: number, value: number): string {
  const channel = (quarterTurns: number) => byteText(channelByte(hue, saturation, value, quarterTurns));
  return `#${channel(5)}${channel(3)}${channel(1)}`;
}

/** The hue of colour bytes: each largest channel owns a sixth of the wheel, `delta` being largest minus smallest. */
function hueOfChannels(red: number, green: number, blue: number, delta: number): number {
  const largest = Math.max(red, green, blue);
  if (largest === green) {
    return wrapHue((2 + (blue - red) / delta) * HUE_PER_SECTOR);
  }
  if (largest === blue) {
    return wrapHue((4 + (red - green) / delta) * HUE_PER_SECTOR);
  }
  return wrapHue(((green - blue) / delta) * HUE_PER_SECTOR);
}

/** The hue, saturation and value of a colour; text that is no colour is undefined. Grey keeps `fallbackHue`. */
export function hexToHsv(text: string, fallbackHue = 0): HsvColor | undefined {
  const hex = readHexInput(text);
  if (hex === undefined) {
    return undefined;
  }
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  const largest = Math.max(red, green, blue);
  const delta = largest - Math.min(red, green, blue);
  return {
    hue: delta === 0 ? fallbackHue : hueOfChannels(red, green, blue, delta),
    saturation: largest === 0 ? 0 : delta / largest,
    value: largest / BYTE_MAX,
  };
}
