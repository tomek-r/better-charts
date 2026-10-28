import type { RenderViewport } from '../../chart/engine/surface/overlayRenderer';
import { DEFAULT_LOADER_COLORS, drawLoader } from '../../../shared/canvas/loader';
import { palette } from '../../../shared/theme/palette';
import type { HandleEdges } from './drawing/handles';
import type { FixedRangeProfileState } from './profileState';

const LOADING_WASH_COLOR = palette.raised;
/** Translucent enough that candles under the wash stay faintly readable. */
export const LOADING_WASH_ALPHA = 0.45;

/**
 * The band between the handles, clamped to the pane, or null when nothing should be drawn
 * for the loading indication: no slow load flagged, no range, a boundary preview, or a band
 * wholly off screen. Shared by the wash and the spinner so they always cover the same band.
 * Without `handles` the band falls back to the requested range.
 */
function loadingBand(
  viewport: RenderViewport,
  state: FixedRangeProfileState,
  handles?: HandleEdges,
): { left: number; right: number } | null {
  const range = state.range;
  if (!range || !state.loadingIndicator || state.previewing) {
    return null;
  }
  const { x, width } = viewport.chartRect;
  const startX = handles?.fromX ?? viewport.timeToX(range.fromMs);
  const endX = handles?.toX ?? viewport.timeToX(range.toMs);
  if (!Number.isFinite(startX) || !Number.isFinite(endX)) {
    return null;
  }
  const left = Math.max(x, Math.min(startX, endX));
  const right = Math.min(x + width, Math.max(startX, endX));
  return left > right ? null : { left, right };
}

/**
 * Loading wash: a semi-transparent veil over the range band (clamped to the pane, full pane
 * height) painted while the slow-load spinner shows. The tool draws it after the histogram, so
 * a profile kept during a refresh is veiled and reads as updating, and before the spinner,
 * which stays on top. Same skip rules as the spinner.
 */
export function drawFixedRangeProfileLoadingWash(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  state: FixedRangeProfileState,
  handles?: HandleEdges,
): void {
  const band = loadingBand(viewport, state, handles);
  if (!band || band.right === band.left) {
    return;
  }
  const { y, height } = viewport.chartRect;
  ctx.save();
  ctx.globalAlpha = LOADING_WASH_ALPHA;
  ctx.fillStyle = LOADING_WASH_COLOR;
  ctx.fillRect(band.left, y, band.right - band.left, height);
  ctx.restore();
}

/**
 * Slow-load profile loader: a tiny mirrored BID/ASK profile (dashed centre line, red bars growing left,
 * teal bars right) centred horizontally in the range band (clamped to the visible pane) and vertically in
 * the pane. Nothing is drawn while the band is wholly off screen, the requester reports no slow load, or a
 * boundary preview is active. `nowMs` only sets the bar widths.
 */
export function drawFixedRangeProfileSpinner(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  state: FixedRangeProfileState,
  nowMs: number,
  handles?: HandleEdges,
): void {
  const band = loadingBand(viewport, state, handles);
  if (!band) {
    return;
  }
  const { y, height } = viewport.chartRect;
  const centerX = (band.left + band.right) / 2;
  drawLoader(ctx, centerX, y + height / 2, nowMs, DEFAULT_LOADER_COLORS);
}
