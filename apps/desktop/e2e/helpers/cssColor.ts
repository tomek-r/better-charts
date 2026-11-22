import { parseHexColor } from './pngPixels';

/**
 * Colours as the specs compare them with `toHaveCSS`: the browser reports a computed colour as
 * `rgb(r, g, b)` text, so a palette hex colour has to be written that way before it can be expected.
 */

/** A palette hex colour written the way `toHaveCSS` reports a computed colour. */
export function rgbText(hex: string): string {
  const [red, green, blue] = parseHexColor(hex);
  return `rgb(${red}, ${green}, ${blue})`;
}
