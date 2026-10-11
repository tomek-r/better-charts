/** Rendering and input share pane coordinates in CSS pixels. */
export interface RenderViewport {
  chartRect: { x: number; y: number; width: number; height: number };
  priceRange: { min: number; max: number };
  visibleRange: { from: number; to: number };
  barWidth: number;
  barSpacing: number;
  offset: number;
  priceToY: (price: number) => number;
  yToPrice: (y: number) => number;
  timeToX: (timeMs: number) => number;
}

export interface OverlayRenderer {
  descriptor: { id: string; name: string; layer: 'overlay' | 'ui' };
  render: (ctx: CanvasRenderingContext2D, args: { viewport: RenderViewport }) => void;
}
