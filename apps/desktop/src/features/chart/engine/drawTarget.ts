import type { IPrimitivePaneRenderer } from 'lightweight-charts';
import type { ChartDrawLayer, ChartDrawTarget, RenderViewport } from './toolContract';

/** The canvas target a primitive renderer draws on (fancy-canvas' `CanvasRenderingTarget2D`). */
export type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

/** The layers the engine paints; one shared object per layer, so a pass allocates nothing. */
export const PANE_BELOW_TRADING_OVERLAYS: ChartDrawLayer = { surface: 'pane', depth: 'belowTradingOverlays' };
export const PRICE_AXIS_BELOW_TRADING_OVERLAYS: ChartDrawLayer = {
  surface: 'priceAxis',
  depth: 'belowTradingOverlays',
};
export const PANE_ABOVE_TRADING_OVERLAYS: ChartDrawLayer = { surface: 'pane', depth: 'aboveTradingOverlays' };
export const TIME_AXIS_ABOVE_TRADING_OVERLAYS: ChartDrawLayer = { surface: 'timeAxis', depth: 'aboveTradingOverlays' };
export const PRICE_AXIS_ABOVE_TRADING_OVERLAYS: ChartDrawLayer = {
  surface: 'priceAxis',
  depth: 'aboveTradingOverlays',
};

/**
 * Builds the draw target for one layer pass on the canvas the caller is already drawing
 * on. Call it inside the renderer's `useMediaCoordinateSpace` scope: `context` is that
 * scope's context, and any transform the caller applied (the price-axis shift) is kept.
 * The bitmap space comes from the library's own `useBitmapCoordinateSpace` for the same
 * canvas, so tools get the pixel ratios from the library instead of reading the transform.
 */
export function createDrawTarget(
  renderTarget: RenderTarget,
  context: CanvasRenderingContext2D,
  viewport: RenderViewport,
  layer: ChartDrawLayer,
): ChartDrawTarget {
  const { horizontalPixelRatio, verticalPixelRatio, width, height } = renderTarget.useBitmapCoordinateSpace(
    ({ horizontalPixelRatio, verticalPixelRatio, bitmapSize }) => ({
      horizontalPixelRatio,
      verticalPixelRatio,
      width: bitmapSize.width,
      height: bitmapSize.height,
    }),
  );
  return {
    context,
    viewport,
    layer,
    bitmap: {
      horizontalPixelRatio,
      verticalPixelRatio,
      width,
      height,
      withContext: (paint) =>
        renderTarget.useBitmapCoordinateSpace(({ context: bitmapContext }) => paint(bitmapContext)),
    },
  };
}
