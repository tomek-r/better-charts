import type { RenderViewport } from '../../surface/overlayTypes';
import type { TradingLabelHit, TradingLabelLayoutState, TradingLabelTarget } from './tradingLabelTypes';

/** Paints a trading label clipped to the pane and records its hit rectangle; with a layout queue
 * the paint is deferred until the labels pass has spaced every row. */
export function paintTradingLabel(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  rows: TradingLabelHit[],
  target: TradingLabelTarget,
  lineY: number,
  draw: (labelY: number) => { x: number; y: number; w: number; h: number },
  layout?: TradingLabelLayoutState,
): void {
  const font = ctx.font;
  const paint = (labelY: number) => {
    ctx.save();
    const { x, y, width, height } = viewport.chartRect;
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.font = font;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    const rect = draw(labelY);
    rows.push({ ...target, ...rect, lineY });
    ctx.restore();
  };
  if (layout) {
    layout.pending.push({ target, y: lineY, draw: paint });
  } else {
    paint(lineY);
  }
}
