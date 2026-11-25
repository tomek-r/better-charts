import { palette } from '../../../../../shared/theme/palette';
import type { DevicePixelRatios } from '../barBodyWidth';
import { footprintTextScale, type FootprintTextStyle } from './footprintTextSize';

/** The colour the value area's lines and marker are drawn in, neutral against the dark chart. */
const VALUE_AREA_COLOR = palette.textTertiary;
/** The dash of a value area line, in css px: three drawn then three clear, which reads as a dashed line. */
export const VALUE_AREA_DASH: readonly number[] = [3, 3];
/** The thickness of a value area line, in css px. */
export const VALUE_AREA_LINE_WIDTH = 1;
/** The narrowest a line is ever drawn, in device pixels, so it stays visible on any screen. */
const NARROWEST_LINE = 1;
/** The glyph marking where a value area line starts, and how far left of the bar it stands, in css px. */
const VALUE_AREA_MARKER = '▶';
/** How far left of the bar the marker stands at the maximum text size, in css px, scaled with the bar's own size. */
export const VALUE_AREA_MARKER_GAP = 2;
/**
 * The narrowest bar, in css px, that marks its value areas: the marker stands left of the bar, so a narrower bar would
 * see it reach over its neighbour while the chart is zoomed out, and keeps its dashed lines alone instead.
 */
export const MIN_MARKER_BAR_WIDTH = 48;
/** A one-pixel line covers a single row of pixels only while it is stroked on that row's centre. */
const ROW_CENTRE = 0.5;

/** The device-pixel span one value area line crosses: the whole bar, its sell column, its gaps and its buy column. */
export interface FootprintValueAreaSpan {
  readonly left: number;
  readonly right: number;
}

/** The media x the marker of a line is written at: just left of the bar, so it points at the line's first dash. */
export function valueAreaMarkerX(span: FootprintValueAreaSpan, style: FootprintTextStyle): number {
  return span.left / style.horizontalPixelRatio - VALUE_AREA_MARKER_GAP * footprintTextScale(style.size);
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

/** Paints one dashed line across `span` at each media y in `ys`, in device pixels. */
export function paintValueAreaLines(
  context: CanvasRenderingContext2D,
  span: FootprintValueAreaSpan,
  ys: readonly number[],
  ratios: DevicePixelRatios,
): void {
  context.save();
  context.strokeStyle = VALUE_AREA_COLOR;
  context.lineWidth = Math.max(NARROWEST_LINE, Math.round(VALUE_AREA_LINE_WIDTH * ratios.horizontalPixelRatio));
  context.setLineDash(VALUE_AREA_DASH.map((segment) => segment * ratios.horizontalPixelRatio));
  for (const y of ys) {
    // Snapped to a row's centre, so a one-pixel line covers that row alone rather than blending into its neighbours.
    const deviceY = Math.round(y * ratios.verticalPixelRatio - ROW_CENTRE) + ROW_CENTRE;
    context.beginPath();
    context.moveTo(span.left, deviceY);
    context.lineTo(span.right, deviceY);
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
