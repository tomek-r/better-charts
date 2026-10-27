import type { RenderViewport } from '../../chart/engine/tools/toolContract';
import type { ProfileResult } from '../../../shared/bridge/types';
import { DEFAULT_LOADER_COLORS, drawLoader } from '../../../shared/canvas/loader';
import { drawSeparatedText } from '../../../shared/canvas/separatedText';
import { palette } from '../../../shared/theme/palette';
import { drawProfileBars, layoutProfileBars } from './profileBars';
import { DEFAULT_FIXED_RANGE_PROFILE_APPEARANCE, type FixedRangeProfileAppearance } from './settings';

/**
 * Volume profile (mirrored down/up bars by default), below trading labels; levels carry no labels. A `bars` profile is an approximation
 * (bid series = DOWN volume, ask = UP volume) and is the only one that carries text: its bar timeframe code.
 */
export interface FixedRangeProfileState {
  /** null/undefined = no active selection — the overlay renders nothing. */
  range?: { fromMs: number; toMs: number } | null;
  /** Profile computed for exactly `range` (Rust side, wire types). */
  profile?: ProfileResult;
  /** The awaited profile request is slow: the overlay veils the range and draws a spinner. Written only by the requester. */
  loadingIndicator?: boolean;
  /** A boundary preview hides the result until release or cancellation. */
  previewing?: boolean;
  /** Painted geometry from the last frame (dev hook / tests). */
  hit: { anchorX?: number; profileLeft?: number; profileRight?: number; pocY?: number; vahY?: number; valY?: number };
}

/** The profile request the app is waiting for; results that do not match it are stale and ignored. */
export type ExpectedFixedRangeProfile = {
  symbol: string;
  fromMs: number;
  endMs: number;
  sentAt: number;
  settled: boolean;
};

// Level lines keep the TAP look: same alpha.
const LEVEL_ALPHA = 0.95;

const BAR_LABEL_COLOR = palette.muted;
/** A profile whose history starts inside the range must not look complete. */
const BAR_LABEL_PARTIAL_COLOR = palette.warnText;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAR_LABEL_FONT = '400 11px system-ui, sans-serif';
const BAR_LABEL_INSET = 6;

type LevelKey = 'poc' | 'vah' | 'val';

const LEVEL_KEYS: readonly LevelKey[] = ['poc', 'vah', 'val'];

// Raw decimal string in, pixel y out; undefined = unset/invalid level.
function levelY(raw: string, viewport: RenderViewport): number | undefined {
  if (raw.trim() === '') {
    return undefined;
  }
  const price = Number(raw);
  if (!Number.isFinite(price)) {
    return undefined;
  }
  return viewport.priceToY(price);
}

/** The horizontal span a level line covers: from the range start to the pane edge or to the range end. */
interface LevelSpan {
  readonly startX: number;
  readonly endX: number;
}

/**
 * Level lines of the TOTAL profile (never the per-mode bidLevels/askLevels sets), painted after the rows.
 * A hidden level paints nothing and reports no y. No text labels (owner).
 */
function drawLevelLines(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  profile: ProfileResult,
  appearance: FixedRangeProfileAppearance,
  span: LevelSpan,
  hit: FixedRangeProfileState['hit'],
): void {
  ctx.globalAlpha = LEVEL_ALPHA;
  for (const key of LEVEL_KEYS) {
    const style = appearance[key];
    const lineY = style.visible ? levelY(profile[key], viewport) : undefined;
    if (lineY === undefined) {
      continue;
    }
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash([...style.dash]);
    ctx.beginPath();
    ctx.moveTo(span.startX, lineY);
    ctx.lineTo(span.endX, lineY);
    ctx.stroke();
    ctx.setLineDash([]);
    hit[`${key}Y`] = lineY;
  }
}

/**
 * The profile of the drawn range. The bars hang from the range start (placement left) or from the range end
 * (placement right) and never leave the range; `handles` gives the end x, which is otherwise the end of the
 * requested range.
 */
export function drawFixedRangeProfile(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  state: FixedRangeProfileState,
  appearance: FixedRangeProfileAppearance = DEFAULT_FIXED_RANGE_PROFILE_APPEARANCE,
  handles?: HandleEdges,
): void {
  const range = state.range;
  const profile = state.profile;
  if (!range || !profile || state.previewing || profile.bins.length === 0) {
    state.hit = {};
    return;
  }
  const { x, width } = viewport.chartRect;
  const startX = viewport.timeToX(range.fromMs);
  const endX = handles?.toX ?? viewport.timeToX(range.toMs);
  const anchorX = appearance.placement === 'right' ? endX : startX;
  if (!Number.isFinite(anchorX) || !Number.isFinite(startX)) {
    state.hit = {};
    return;
  }
  const layout = layoutProfileBars(profile, viewport, appearance, Math.max(0, endX - startX));
  const hit: FixedRangeProfileState['hit'] = {
    anchorX,
    profileLeft: anchorX + layout.reachLeft,
    profileRight: anchorX + layout.reachRight,
  };

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, viewport.chartRect.y, width, viewport.chartRect.height);
  ctx.clip();
  // The bars also stay inside the range box, whatever the pane shows of it.
  ctx.save();
  ctx.beginPath();
  ctx.rect(startX, viewport.chartRect.y, Math.max(0, endX - startX), viewport.chartRect.height);
  ctx.clip();
  drawProfileBars(ctx, anchorX, layout, appearance);
  ctx.restore();
  const lineEndX = appearance.extendRight ? x + width : endX;
  if (Number.isFinite(lineEndX)) {
    drawLevelLines(ctx, viewport, profile, appearance, { startX, endX: lineEndX }, hit);
  }
  if (profile.source === 'bars' && profile.barTimeframe) {
    drawBarTimeframeLabel(ctx, viewport, startX, profile.barTimeframe, profile.coveredFromMs);
  }
  ctx.restore();
  state.hit = hit;
}

/**
 * Top-left corner of the range band, kept inside the pane when the band starts off screen. Canvas units are CSS
 * pixels (the context is already scaled by the device pixel ratio), so the inset and font size need no DPR factor.
 */
function drawBarTimeframeLabel(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  bandLeft: number,
  timeframe: string,
  coveredFromMs: number | null,
): void {
  const { x, y } = viewport.chartRect;
  ctx.globalAlpha = 1;
  ctx.fillStyle = coveredFromMs === null ? BAR_LABEL_COLOR : BAR_LABEL_PARTIAL_COLOR;
  ctx.font = BAR_LABEL_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const parts = coveredFromMs === null ? [timeframe] : [timeframe, `from ${formatUtcDayMonth(coveredFromMs)}`];
  drawSeparatedText(ctx, parts, Math.max(x, bandLeft) + BAR_LABEL_INSET, y + BAR_LABEL_INSET);
}

/** `20 Mar`: UTC day and short English month, independent of the browser locale. */
function formatUtcDayMonth(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]}`;
}

const LOADING_WASH_COLOR = palette.raised;
/** Translucent enough that candles under the wash stay faintly readable. */
export const LOADING_WASH_ALPHA = 0.45;

/**
 * The pane x of the two selection handles. The loading band spans exactly these: `state.range.toMs`
 * is the request end clipped to the live edge, so it stops at the newest bar when the handle sits
 * on a future slot.
 */
export interface HandleEdges {
  fromX: number;
  toX: number;
}

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
