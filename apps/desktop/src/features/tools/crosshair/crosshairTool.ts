import { dashPatternOf } from '../../../shared/canvas/dashPatterns';
import type { ChartDrawTarget, ChartTool, ChartToolHost } from '../../chart/engine/tools/toolContract';

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
 * Fills the run a crosshair line covers along its own axis, in device pixels: one bar while the
 * line is solid, otherwise the dashes of its style, each run rounded to a whole device pixel so
 * the line stays crisp at every pixel ratio.
 */
function paintRun(
  length: number,
  pattern: readonly number[] | undefined,
  pixelRatio: number,
  paint: (offset: number, run: number) => void,
): void {
  if (pattern === undefined) {
    paint(0, length);
    return;
  }
  let offset = 0;
  for (let index = 0; offset < length; index += 1) {
    const run = Math.max(1, Math.round(pattern[index % pattern.length] * pixelRatio));
    if (index % 2 === 0) {
      paint(offset, Math.min(run, length - offset));
    }
    offset += run;
  }
}

/**
 * Draws full-width and full-height 1 CSS px lines through the pointer while active
 * and the pointer is over the pane, in the colour and dash the chart's settings give
 * the crosshair. They continue over both axes, so the engine's time and price labels
 * are visibly attached to them. The labels themselves belong to the engine and
 * follow every tool.
 */
export class CrosshairTool implements ChartTool {
  /** Pointer position in pane CSS px; null while it is outside the pane or the tool is not active. */
  private point: { x: number; y: number } | null = null;

  constructor(private readonly host: Pick<ChartToolHost, 'requestRepaint' | 'crosshairStyle'>) {}

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
    const { color, style } = this.host.crosshairStyle();
    const pattern = dashPatternOf(style);
    target.bitmap.withContext((context) => {
      context.fillStyle = color;
      if (surface !== 'priceAxis') {
        const { start, thickness } = snappedLine(point.x, horizontalPixelRatio);
        paintRun(height, pattern, verticalPixelRatio, (offset, run) => {
          context.fillRect(start, offset, thickness, run);
        });
      }
      if (surface !== 'timeAxis') {
        const { start, thickness } = snappedLine(point.y, verticalPixelRatio);
        paintRun(width, pattern, horizontalPixelRatio, (offset, run) => {
          context.fillRect(offset, start, run, thickness);
        });
      }
    });
  }

  testApi(): CrosshairTestApi {
    return { linesVisible: () => this.point !== null };
  }
}
