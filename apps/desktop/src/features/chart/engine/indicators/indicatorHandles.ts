/** Radius of a handle's dot: 4 CSS pixels, filled with its plot's colour. */
const HANDLE_RADIUS_CSS_PX = 4;

/** Width of the pane-background ring that keeps a dot apart from the line under it, in CSS pixels. */
const HANDLE_RING_CSS_PX = 1;

/** A dot's radius in bitmap pixels, so it stays `HANDLE_RADIUS_CSS_PX` CSS pixels across. */
export function handleRadius(pixelRatio: number): number {
  return HANDLE_RADIUS_CSS_PX * pixelRatio;
}

/** A ring's width in bitmap pixels, so it stays `HANDLE_RING_CSS_PX` CSS pixels wide. */
export function handleRingWidth(pixelRatio: number): number {
  return HANDLE_RING_CSS_PX * pixelRatio;
}
