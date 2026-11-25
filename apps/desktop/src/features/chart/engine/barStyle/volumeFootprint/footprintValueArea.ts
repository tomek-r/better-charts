import { palette } from '../../../../../shared/theme/palette';
import type { DevicePixelRatios } from '../barBodyWidth';
import { footprintTextScale, type FootprintTextStyle } from './footprintTextSize';

/** The colour the value area's lines and marker are drawn in, neutral against the dark chart. */
const VALUE_AREA_COLOR = palette.textTertiary;
/** The dash of a value area line, in css px: one dot drawn then two clear, which reads as a line of short dots. */
export const VALUE_AREA_DASH: readonly number[] = [1, 2];
/** The thickness of a value area line, in css px. */
export const VALUE_AREA_LINE_WIDTH = 1;
/** The narrowest a line is ever drawn, in device pixels, so it stays visible on any screen. */
const NARROWEST_LINE = 1;
/** The narrowest one dot of a line's dash is ever drawn, in device pixels, so no dot of it vanishes. */
const NARROWEST_DOT = 1;
/** How far past each outermost column edge a line runs, in css px, so it stands clear of the bar's columns. */
export const VALUE_AREA_OVERHANG = 4;
/** The glyph marking where a value area line starts, and how far left of it the glyph stands, in css px. */
const VALUE_AREA_MARKER = '▶';
/** How far left of a line's left end the marker stands at the maximum text size, in css px, scaled with the bar. */
export const VALUE_AREA_MARKER_GAP = 2;
/**
 * The narrowest bar, in css px, that marks its value areas: the marker stands left of the bar, so a narrower bar would
 * see it reach over its neighbour while the chart is zoomed out, and keeps its dotted lines alone instead.
 */
export const MIN_MARKER_BAR_WIDTH = 48;
/** A one-pixel line covers a single row of pixels only while it is stroked on that row's centre. */
const ROW_CENTRE = 0.5;

/**
 * The device-pixel span one value area line crosses the bar's columns over: the sell column's left edge — or, in the
 * single-column layout, the thin candle's, where the empty sell slot stands — out to the buy column's right one. The
 * line itself is drawn VALUE_AREA_OVERHANG css px past either end of it.
 */
export interface FootprintValueAreaSpan {
  readonly left: number;
  readonly right: number;
}

/** How far past either side of a span a value area line is drawn, in whole device pixels. */
function valueAreaOverhangPixels(horizontalPixelRatio: number): number {
  return Math.round(VALUE_AREA_OVERHANG * horizontalPixelRatio);
}

/**
 * The device-pixel span one value area line itself covers: the columns' span and the overhang past either outermost
 * column edge, so the line runs a little past both outer edges of the bar's columns.
 */
export function valueAreaLineSpan(span: FootprintValueAreaSpan, horizontalPixelRatio: number): FootprintValueAreaSpan {
  const overhang = valueAreaOverhangPixels(horizontalPixelRatio);
  return { left: span.left - overhang, right: span.right + overhang };
}

/** The dash a value area line is stroked with, in device pixels, each stretch of it a whole pixel wide. */
export function valueAreaDashPixels(horizontalPixelRatio: number): number[] {
  return VALUE_AREA_DASH.map((segment) => Math.max(NARROWEST_DOT, Math.round(segment * horizontalPixelRatio)));
}

/**
 * The media x the marker of a line is written at: just left of the line's own left end, so it points at the line's
 * first dot, its gap scaled with the bar's text size.
 */
export function valueAreaMarkerX(span: FootprintValueAreaSpan, style: FootprintTextStyle): number {
  const line = valueAreaLineSpan(span, style.horizontalPixelRatio);
  return line.left / style.horizontalPixelRatio - VALUE_AREA_MARKER_GAP * footprintTextScale(style.size);
}

/** Where the media pass writes one bar's value area marker, and the media y of each line it points at. */
export interface FootprintValueAreaMark {
  readonly markerX: number;
  readonly ys: readonly number[];
  /** The size the whole bar writes its numbers in, in css px, which the marker's glyph is written at. */
  readonly size: number;
}

/** How wide one bar's group — its columns and the thin candle between them — is, in css px. */
function valueAreaGroupWidth(span: FootprintValueAreaSpan, style: FootprintTextStyle): number {
  return (span.right - span.left) / style.horizontalPixelRatio;
}

/**
 * The marker one bar's value area lines are written with, at the bar's own text size and its gap scaled the same way,
 * or none while the bar writes no number at all or its group is narrower than MIN_MARKER_BAR_WIDTH. The lines
 * themselves are drawn either way.
 */
export function valueAreaMark(
  span: FootprintValueAreaSpan,
  ys: readonly number[],
  style: FootprintTextStyle | null,
): FootprintValueAreaMark | null {
  if (style === null) {
    return null;
  }
  if (valueAreaGroupWidth(span, style) < MIN_MARKER_BAR_WIDTH) {
    return null;
  }
  return { markerX: valueAreaMarkerX(span, style), ys, size: style.size };
}

/** Paints one dotted line across `span` and the overhang past either of its ends at each media y in `ys`. */
export function paintValueAreaLines(
  context: CanvasRenderingContext2D,
  span: FootprintValueAreaSpan,
  ys: readonly number[],
  ratios: DevicePixelRatios,
): void {
  const line = valueAreaLineSpan(span, ratios.horizontalPixelRatio);
  context.save();
  context.strokeStyle = VALUE_AREA_COLOR;
  context.lineWidth = Math.max(NARROWEST_LINE, Math.round(VALUE_AREA_LINE_WIDTH * ratios.horizontalPixelRatio));
  context.setLineDash(valueAreaDashPixels(ratios.horizontalPixelRatio));
  for (const y of ys) {
    // Snapped to a row's centre, so a one-pixel line covers that row alone rather than blending into its neighbours.
    const deviceY = Math.round(y * ratios.verticalPixelRatio - ROW_CENTRE) + ROW_CENTRE;
    context.beginPath();
    context.moveTo(line.left, deviceY);
    context.lineTo(line.right, deviceY);
    context.stroke();
  }
  context.restore();
}

/** Writes the marker of every line of `mark` at the line's own y, in the font the caller has set for its size. */
export function paintValueAreaMarkers(context: CanvasRenderingContext2D, mark: FootprintValueAreaMark): void {
  context.save();
  context.fillStyle = VALUE_AREA_COLOR;
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (const y of mark.ys) {
    context.fillText(VALUE_AREA_MARKER, mark.markerX, y);
  }
  context.restore();
}
