import type { OverlayRenderer } from '../../src/features/chart/engine/overlayTypes';

/**
 * Shared Node-side harness for overlay paint specs: a fixed linear viewport and
 * a recording 2D context that captures every paint call with its colour, alpha,
 * dash and extents, so assertions run on exactly what the pixels would show.
 */

export type PaintOpKind = 'clip' | 'fill' | 'fillRect' | 'stroke' | 'fillText';

export interface PaintOp {
  kind: PaintOpKind;
  style: string;
  alpha: number;
  dashed: boolean;
  dash: number[];
  font: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Exact fillText anchor (min/max above mirror it for extent-style checks). */
  x?: number;
  y?: number;
  text?: string;
}

/** Linear 100-200 price scale over a 600x400 pane: priceY(p) = 45 + (200 - p) * 4. */
export function createTestViewport(view: {
  offset: number;
  visibleRange: { from: number; to: number };
  scaleMode: string;
}) {
  return {
    chartRect: { x: 41, y: 45, width: 600, height: 400 },
    priceRange: { min: 100, max: 200 },
    barSpacing: 2,
    barWidth: 8,
    logScale: false,
    ...view,
    priceToY(price: number): number {
      return (
        this.chartRect.y +
        ((this.priceRange.max - price) / (this.priceRange.max - this.priceRange.min)) * this.chartRect.height
      );
    },
    yToPrice(y: number): number {
      return (
        this.priceRange.max -
        ((y - this.chartRect.y) / this.chartRect.height) * (this.priceRange.max - this.priceRange.min)
      );
    },
    timeToX(timeMs: number): number {
      const index = Math.max(0, Math.min(9, (timeMs - 1_000) / 60_000));
      return this.chartRect.x + index * (this.barWidth + this.barSpacing) - this.offset + this.barWidth / 2;
    },
  };
}

export type TestViewport = ReturnType<typeof createTestViewport>;

/** Render arguments whose mapping functions no longer depend on `this`. */
export function renderArgsFor(viewport: TestViewport): Parameters<OverlayRenderer['render']>[1] {
  return {
    viewport: {
      ...viewport,
      priceToY: viewport.priceToY.bind(viewport),
      yToPrice: viewport.yToPrice.bind(viewport),
      timeToX: viewport.timeToX.bind(viewport),
    },
  } as Parameters<OverlayRenderer['render']>[1];
}

/**
 * Recording 2D context. `textBox: 'anchor'` records a text op as its exact
 * point; `'label'` as a 30x16 box around it, for overlap checks between rows.
 */
export function createRecordingCtx(
  record: (op: PaintOp) => void,
  options: { textBox?: 'anchor' | 'label'; recordClip?: boolean } = {},
): CanvasRenderingContext2D {
  let pathXs: number[] = [];
  let pathYs: number[] = [];
  let dash: number[] = [];
  const extent = () => ({
    minX: Math.min(...pathXs),
    maxX: Math.max(...pathXs),
    minY: Math.min(...pathYs),
    maxY: Math.max(...pathYs),
  });
  const paint = (kind: PaintOpKind, dashed: boolean) => ({
    kind,
    style: kind === 'stroke' ? ctx.strokeStyle : ctx.fillStyle,
    alpha: ctx.globalAlpha,
    dashed,
    dash: dashed ? [...dash] : [],
    font: ctx.font,
  });
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save() {},
    restore() {},
    closePath() {},
    beginPath() {
      pathXs = [];
      pathYs = [];
    },
    rect(px: number, py: number, w: number, h: number) {
      pathXs.push(px, px + w);
      pathYs.push(py, py + h);
    },
    clip() {
      if (options.recordClip) {
        record({ ...paint('clip', false), style: '', font: '', ...extent() });
      }
    },
    moveTo(px: number, py: number) {
      pathXs.push(px);
      pathYs.push(py);
    },
    lineTo(px: number, py: number) {
      pathXs.push(px);
      pathYs.push(py);
    },
    quadraticCurveTo(cx: number, cy: number, px: number, py: number) {
      pathXs.push(cx, px);
      pathYs.push(cy, py);
    },
    arc(cx: number, cy: number, r: number) {
      pathXs.push(cx - r, cx + r);
      pathYs.push(cy - r, cy + r);
    },
    setLineDash(next: number[]) {
      dash = [...next];
    },
    measureText(text: string) {
      return { width: text.length * 7 };
    },
    stroke() {
      record({ ...paint('stroke', dash.length > 0), ...extent() });
    },
    fill() {
      record({ ...paint('fill', false), ...extent() });
    },
    fillRect(px: number, py: number, w: number, h: number) {
      record({ ...paint('fillRect', false), minX: px, maxX: px + w, minY: py, maxY: py + h });
    },
    fillText(text: string, px: number, py: number) {
      const label = options.textBox === 'label';
      record({
        ...paint('fillText', false),
        minX: px,
        maxX: label ? px + 30 : px,
        minY: label ? py - 8 : py,
        maxY: label ? py + 8 : py,
        x: px,
        y: py,
        text,
      });
    },
  };
  return ctx as unknown as CanvasRenderingContext2D;
}
