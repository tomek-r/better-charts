import { useEffect, useRef, type RefObject } from 'react';
import { drawLoader, LOADER_HEIGHT, LOADER_WIDTH } from '../canvas/loader';
import { palette } from '../theme/palette';

const LOADER_COLORS = { bid: palette.sell, ask: palette.buy, line: palette.textBright };
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Falling back to 1 keeps the loader drawn if a context reports no ratio. */
function deviceScale(): number {
  return window.devicePixelRatio || 1;
}

/**
 * Sizes the backing store for the device pixel ratio and maps the context onto CSS pixels, so the 1px centre
 * line stays crisp on dense screens while the painter keeps working in CSS units.
 */
function prepareContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  const scale = deviceScale();
  canvas.width = LOADER_WIDTH * scale;
  canvas.height = LOADER_HEIGHT * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return ctx;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** One frame: the canvas cleared, then the loader redrawn centred at `nowMs`. */
function paintFrame(ctx: CanvasRenderingContext2D, nowMs: number): void {
  ctx.clearRect(0, 0, LOADER_WIDTH, LOADER_HEIGHT);
  drawLoader(ctx, LOADER_WIDTH / 2, LOADER_HEIGHT / 2, nowMs, LOADER_COLORS);
}

/**
 * Paints the loader frame after frame until unmount. Under reduced motion one still frame is enough, and an
 * endless animation would be exactly the motion the preference asks to suppress.
 */
function useLoaderAnimation(canvasRef: RefObject<HTMLCanvasElement | null>): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = prepareContext(canvas);
    if (!ctx) {
      return;
    }
    if (prefersReducedMotion()) {
      paintFrame(ctx, 0);
      return;
    }
    let frame = 0;
    const paintNextFrame = () => {
      paintFrame(ctx, performance.now());
      frame = requestAnimationFrame(paintNextFrame);
    };
    frame = requestAnimationFrame(paintNextFrame);
    return () => cancelAnimationFrame(frame);
  }, [canvasRef]);
}

/** The app-wide loader: the volume profile's animated dashed line with its mirrored BID/ASK bars. */
export function Loader() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useLoaderAnimation(canvasRef);
  const scale = deviceScale();
  return (
    <canvas
      ref={canvasRef}
      className="loader"
      aria-hidden="true"
      width={LOADER_WIDTH * scale}
      height={LOADER_HEIGHT * scale}
      style={{ width: LOADER_WIDTH, height: LOADER_HEIGHT }}
    />
  );
}
