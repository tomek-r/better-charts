import { palette } from '../../../../../shared/theme/palette';
import type { DevicePixelRatios } from '../barBodyWidth';

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
const VALUE_AREA_MARKER_GAP = 2;
/** A one-pixel line covers a single row of pixels only while it is stroked on that row's centre. */
const ROW_CENTRE = 0.5;

/** The device-pixel span one value area line crosses: the whole bar, its sell column, its gaps and its buy column. */
export interface FootprintValueAreaSpan {
  readonly left: number;
  readonly right: number;
}

/** The media x the marker of a line is written at: just left of the bar, so it points at the line's first dash. */
export function valueAreaMarkerX(span: FootprintValueAreaSpan, horizontalPixelRatio: number): number {
  return span.left / horizontalPixelRatio - VALUE_AREA_MARKER_GAP;
}

/** Where the media pass writes one bar's value area marker, and the media y of each line it points at. */
export interface FootprintValueAreaMark {
  readonly markerX: number;
  readonly ys: readonly number[];
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

/** Writes the marker of every line of `mark` at the line's own y, in the media pass's own font. */
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
