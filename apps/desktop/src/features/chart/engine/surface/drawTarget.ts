import type { IPrimitivePaneRenderer } from 'lightweight-charts';
import type { ChartDrawLayer, ChartDrawingPaintTarget, ChartDrawTarget } from '../tools/toolContract';
import type { RenderViewport } from './overlayRenderer';

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
 * Builds the target of one drawing's paint pass on the pane: no layer with it, because the chart's
 * stacking order, not the tool, decides where the drawing paints. Call it inside the renderer's
 * `useMediaCoordinateSpace` scope, like `createDrawTarget`.
 */
export function createDrawingPaintTarget(
  renderTarget: RenderTarget,
  context: CanvasRenderingContext2D,
  viewport: RenderViewport,
): ChartDrawingPaintTarget {
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
  return { ...createDrawingPaintTarget(renderTarget, context, viewport), layer };
}
