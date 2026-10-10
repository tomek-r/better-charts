let measurer: CanvasRenderingContext2D | null = null;

/** Width of `text` in `font` on a shared off-screen canvas; 0 when no 2D context exists. */
export function measureTextWidth(text: string, font: string): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (measurer === null) {
    return 0;
  }
  measurer.font = font;
  return measurer.measureText(text).width;
}
