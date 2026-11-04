/** The share of the bar spacing a body may cover, which is what the built-in candles draw their bodies at. */
const BODY_SPACING_SHARE = 0.8;

/** One device pixel, the thickness of the outlines the custom bar renderers stroke. */
const ONE_DEVICE_PIXEL = 1;

/** How many device pixels one media pixel covers, which the canvas asks the window for. */
export interface DevicePixelRatios {
  readonly horizontalPixelRatio: number;
  readonly verticalPixelRatio: number;
}

/** A rectangle in device pixels, such as where one bar's body is painted. */
export interface DeviceBarBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The widest a body may be at `barSpacing`, in device pixels, as the built-in candles draw it. */
export function barBodyWidth(barSpacing: number, horizontalPixelRatio: number): number {
  return Math.max(ONE_DEVICE_PIXEL, Math.floor(barSpacing * BODY_SPACING_SHARE * horizontalPixelRatio));
}

/**
 * The box a body `widthPx` device pixels wide covers between the media y `topY` and `bottomY`: centred
 * on the bar's `x`, and at least one device pixel tall so a bar of no range still shows.
 */
export function deviceBarBox(
  x: number,
  widthPx: number,
  topY: number,
  bottomY: number,
  ratios: DevicePixelRatios,
): DeviceBarBox {
  const top = Math.round(topY * ratios.verticalPixelRatio);
  return {
    left: Math.round(x * ratios.horizontalPixelRatio) - Math.floor(widthPx / 2),
    top,
    width: widthPx,
    height: Math.max(ONE_DEVICE_PIXEL, Math.round(bottomY * ratios.verticalPixelRatio) - top),
  };
}

/** Strokes a one-device-pixel outline just inside `body`, so the border stays on the body's own pixels. */
export function strokeBodyOutline(context: CanvasRenderingContext2D, body: DeviceBarBox): void {
  context.lineWidth = ONE_DEVICE_PIXEL;
  // A one-pixel stroke sits on the half pixel, so it covers the box's outermost pixels and no more.
  const width = Math.max(ONE_DEVICE_PIXEL, body.width - ONE_DEVICE_PIXEL);
  const height = Math.max(ONE_DEVICE_PIXEL, body.height - ONE_DEVICE_PIXEL);
  context.strokeRect(body.left + 0.5, body.top + 0.5, width, height);
}
