import type { ChartDrawTarget, ChartTool, ChartToolHost } from '../../chart/engine/tools/toolContract';
import { palette } from '../../../shared/theme/palette';

/** Colours come from the shared palette — a canvas renderer cannot read CSS variables. */
const LINE_COLOR = palette.textLabel;

/** What the e2e suite reads through `window.__chartTest.tool('crosshair')` (dev builds only). */
export interface CrosshairTestApi {
  /** Whether the lines are drawn right now: the tool is active and the pointer is over the pane. */
  linesVisible(): boolean;
}

/** A line through a CSS-px coordinate, in device pixels: the whole-pixel thickness and where it starts. */
function snappedLine(pointCss: number, pixelRatio: number): { start: number; thickness: number } {
  const thickness = Math.max(1, Math.floor(pixelRatio));
  return { start: Math.round(pointCss * pixelRatio - thickness / 2), thickness };
}

/**
 * Draws full-width and full-height 1 CSS px lines through the pointer while active
 * and the pointer is over the pane. They continue over both axes, so the engine's
 * time and price labels are visibly attached to them. The labels themselves belong
 * to the engine and follow every tool.
 */
export class CrosshairTool implements ChartTool {
  /** Pointer position in pane CSS px; null while it is outside the pane or the tool is not active. */
  private point: { x: number; y: number } | null = null;

  constructor(private readonly host: Pick<ChartToolHost, 'requestRepaint'>) {}

  activate(): void {
    this.host.requestRepaint();
  }

  deactivate(): void {
    this.host.requestRepaint();
  }

  pointerHover(x: number, y: number): void {
    this.point = { x, y };
  }

  pointerLeave(): void {
    this.point = null;
  }

  draw(target: ChartDrawTarget): void {
    const point = this.point;
    if (target.layer.depth !== 'aboveTradingOverlays' || point === null) {
      return;
    }
    // Filled rectangles in device pixels, not strokes: a stroke centred on an integer
    // coordinate covers half of each neighbouring pixel when its width is odd, which
    // blurs a 1px line into a 2px one at half alpha. A rectangle snapped to the grid
    // is exactly lineWidth pixels wide at every pixel ratio.
    const { horizontalPixelRatio, verticalPixelRatio, width, height } = target.bitmap;
    const { surface } = target.layer;
    target.bitmap.withContext((context) => {
      context.fillStyle = LINE_COLOR;
      if (surface !== 'priceAxis') {
        const vertical = snappedLine(point.x, horizontalPixelRatio);
        context.fillRect(vertical.start, 0, vertical.thickness, height);
      }
      if (surface !== 'timeAxis') {
        const horizontal = snappedLine(point.y, verticalPixelRatio);
        context.fillRect(0, horizontal.start, width, horizontal.thickness);
      }
    });
  }

  testApi(): CrosshairTestApi {
    return { linesVisible: () => this.point !== null };
  }
}
