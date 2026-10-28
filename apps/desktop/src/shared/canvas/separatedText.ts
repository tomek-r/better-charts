/**
 * Canvas side of the app's one separator convention: the filled diamond of `shared/ui/icons/SeparatorIcon.tsx`
 * between text parts, a space either side. Canvas labels cannot render that component, so they draw it
 * here, with the same proportions as the 8×8 SVG path scaled to the current font.
 */

/** Diamond size relative to the font: the glyph spans 7 units of its 8-unit box, drawn at about 0.6em. */
const DIAMOND_SIZE_EM = 0.6;
/** Optical middle of a line of text above the alphabetic baseline: half its cap height, in em. */
const BASELINE_TO_TEXT_CENTRE_EM = 0.3;
const FONT_SIZE_PATTERN = /(\d+(?:\.\d+)?)px/;
/** Every canvas font the app sets carries its pixel size; this is the labels' body size if one ever does not. */
const FALLBACK_FONT_SIZE_PX = 12;

/** What one separator costs: the space, the diamond and the space around it. */
interface SeparatorMetrics {
  fontPx: number;
  size: number;
  /** A space, the diamond and a space — the whole gap between two parts. */
  advance: number;
}

function fontSizePx(font: string): number {
  const match = FONT_SIZE_PATTERN.exec(font);
  return match ? Number(match[1]) : FALLBACK_FONT_SIZE_PX;
}

function separatorMetrics(ctx: CanvasRenderingContext2D): SeparatorMetrics {
  const fontPx = fontSizePx(ctx.font);
  const size = DIAMOND_SIZE_EM * fontPx;
  return { fontPx, size, advance: ctx.measureText(' ').width * 2 + size };
}

/** Total width of `parts` painted by `drawSeparatedText` with the context's current font. */
export function separatedTextWidth(ctx: CanvasRenderingContext2D, parts: string[]): number {
  if (parts.length === 0) {
    return 0;
  }
  const partsWidth = parts.reduce((width, part) => width + ctx.measureText(part).width, 0);
  return partsWidth + separatorMetrics(ctx).advance * (parts.length - 1);
}

/** Vertical middle of the glyphs drawn at `baselineY`, for the context's current `textBaseline`. */
function textCentreY(textBaseline: CanvasTextBaseline, baselineY: number, fontPx: number): number {
  if (textBaseline === 'top') {
    return baselineY + fontPx / 2;
  }
  if (textBaseline === 'middle') {
    return baselineY;
  }
  return baselineY - BASELINE_TO_TEXT_CENTRE_EM * fontPx;
}

function paintDiamond(ctx: CanvasRenderingContext2D, centreX: number, centreY: number, size: number): void {
  const half = size / 2;
  ctx.beginPath();
  ctx.moveTo(centreX, centreY - half);
  ctx.lineTo(centreX + half, centreY);
  ctx.lineTo(centreX, centreY + half);
  ctx.lineTo(centreX - half, centreY);
  ctx.closePath();
  ctx.fill();
}

/**
 * Paints `parts` from `x` on the line whose baseline is `textY`, separated by the diamond. Uses the
 * context's current font, fillStyle, alignment and baseline; `separatedTextWidth` measures the same paint.
 */
export function drawSeparatedText(ctx: CanvasRenderingContext2D, parts: string[], x: number, textY: number): void {
  const metrics = separatorMetrics(ctx);
  const centreY = textCentreY(ctx.textBaseline, textY, metrics.fontPx);
  let cursorX = x;
  parts.forEach((part, index) => {
    if (index > 0) {
      paintDiamond(ctx, cursorX + metrics.advance / 2, centreY, metrics.size);
      cursorX += metrics.advance;
    }
    ctx.fillText(part, cursorX, textY);
    cursorX += ctx.measureText(part).width;
  });
}
