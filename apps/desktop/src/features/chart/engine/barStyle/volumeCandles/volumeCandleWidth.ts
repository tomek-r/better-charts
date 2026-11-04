/**
 * The share of the body width even the thinnest bar keeps, so a bar of no volume against a busy window
 * is still a bar rather than a sliver.
 */
const MIN_VOLUME_SHARE = 0.2;

/** The narrowest a body is ever drawn, in device pixels. */
const NARROWEST_BODY_WIDTH = 1;

/**
 * How wide one bar's body is drawn: `fullWidth` less the share its volume makes up of the largest volume
 * in the visible window, which widest bars get in full. A window with no volume draws every body in full.
 */
export function volumeCandleWidth(volume: number, maxVolume: number, fullWidth: number): number {
  if (maxVolume <= 0) {
    return Math.max(NARROWEST_BODY_WIDTH, Math.round(fullWidth));
  }
  const share = MIN_VOLUME_SHARE + (1 - MIN_VOLUME_SHARE) * (volume / maxVolume);
  return Math.max(NARROWEST_BODY_WIDTH, Math.round(fullWidth * share));
}
