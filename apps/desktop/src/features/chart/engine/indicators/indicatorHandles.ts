/** Outer diameter of a handle's ring: 9 CSS pixels, the ring TradingView draws on a selected plot. */
const HANDLE_DIAMETER_CSS_PX = 9;

/** Width of the ring's stroke: 1.5 CSS pixels, as TradingView strokes it. */
const HANDLE_STROKE_CSS_PX = 1.5;

/** How a handle's ring measures at one pixel ratio, in bitmap pixels. */
export interface HandleRing {
  /** Radius of the disc the pane background fills: the ring's outer edge. */
  readonly fillRadius: number;
  /** Radius the stroke is centred on, half a stroke inside the outer edge. */
  readonly strokeRadius: number;
  /** Width of the stroke round the ring. */
  readonly strokeWidth: number;
}

/** The ring of a handle at `pixelRatio`, so it stays 9 CSS pixels across with a 1.5 CSS pixel stroke. */
export function handleRing(pixelRatio: number): HandleRing {
  const outerRadius = HANDLE_DIAMETER_CSS_PX / 2;
  return {
    fillRadius: outerRadius * pixelRatio,
    strokeRadius: (outerRadius - HANDLE_STROKE_CSS_PX / 2) * pixelRatio,
    strokeWidth: HANDLE_STROKE_CSS_PX * pixelRatio,
  };
}
