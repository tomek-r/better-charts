import type { RenderViewport } from '../../chart/engine/toolContract';
import type { ProfileResult, TickProfileBin } from '../../../shared/bridge/types';
import { drawProfileLoader } from '../../../shared/canvas/profileLoader';
import { drawSeparatedText } from '../../../shared/canvas/separatedText';
import { palette } from '../../../shared/theme/palette';

/**
 * Mirrored BID/ASK profile, below trading labels; levels carry no labels. A `bars` profile is an approximation
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

// The app's sell/buy convention (tradingOverlayDrawing TRADING_COLORS): the bid is
// what you SELL at (red, mirrored LEFT), the ask what you BUY at (blue, RIGHT).
const BID_COLOR = palette.sell;
const ASK_COLOR = palette.buy;
const POC_COLOR = palette.profilePoc;
const VA_COLOR = palette.textBright;
const ROW_ALPHA = 0.75;
const POC_ROW_ALPHA = 1;
// Level lines keep the TAP look: same alpha.
const LEVEL_ALPHA = 0.95;

const BAR_LABEL_COLOR = palette.muted;
/** A profile whose history starts inside the range must not look complete. */
const BAR_LABEL_PARTIAL_COLOR = palette.warnText;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAR_LABEL_FONT = '400 11px system-ui, sans-serif';
const BAR_LABEL_INSET = 6;

// Weights arrive as decimal strings but are parsed defensively, exactly
// like tickActivityOverlay's binWeight: invalid or non-positive counts as 0.
type WeightSide = 'bid' | 'ask' | 'total';

function binWeight(bin: TickProfileBin, side: WeightSide): number {
  const value = Number(bin[side]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function priceY(price: number, viewport: RenderViewport): number {
  return viewport.priceToY(price);
}

type LevelKey = 'poc' | 'vah' | 'val';

interface LevelDef {
  key: LevelKey;
  raw: string;
  color: string;
  /** Line dash pattern — POC solid, VAH/VAL dashed [4, 3] (owner). */
  dash: number[];
}

// Total-profile levels only — never the per-mode (bidLevels/askLevels) sets.
function levelDefs(profile: ProfileResult): LevelDef[] {
  return [
    { key: 'poc', raw: profile.poc, color: POC_COLOR, dash: [] },
    { key: 'vah', raw: profile.vah, color: VA_COLOR, dash: [4, 3] },
    { key: 'val', raw: profile.val, color: VA_COLOR, dash: [4, 3] },
  ];
}

// Raw decimal string in, pixel y out; undefined = unset/invalid level.
function levelY(raw: string, viewport: RenderViewport): number | undefined {
  if (raw.trim() === '') {
    return undefined;
  }
  const price = Number(raw);
  if (!Number.isFinite(price)) {
    return undefined;
  }
  return priceY(price, viewport);
}

interface ProfileRow {
  top: number;
  bottom: number;
  bidWidth: number;
  askWidth: number;
  /** The bin containing profile.poc — paints at full alpha. */
  isPoc: boolean;
}

export function drawFixedRangeProfile(
  ctx: CanvasRenderingContext2D,
  viewport: RenderViewport,
  state: FixedRangeProfileState,
): void {
  const range = state.range;
  const profile = state.profile;
  if (!range || !profile || state.previewing || profile.bins.length === 0) {
    state.hit = {};
    return;
  }
  const { x, width } = viewport.chartRect;
  const anchorX = viewport.timeToX(range.fromMs);
  if (!Number.isFinite(anchorX)) {
    state.hit = {};
    return;
  }
  // One COMMON denominator across both sides so bid/ask dominance is
  // comparable; the max(1, …) guard only matters when every weight is 0.
  const half = Math.min(180, width * 0.2);
  let maxWeight = 1;
  for (const bin of profile.bins) {
    maxWeight = Math.max(maxWeight, binWeight(bin, 'bid'), binWeight(bin, 'ask'));
  }

  const pocPrice = Number(profile.poc);
  const pocValid = Number.isFinite(pocPrice);
  let pocClaimed = false;
  let maxBidWidth = 0;
  let maxAskWidth = 0;
  const rows: ProfileRow[] = [];
  for (const bin of profile.bins) {
    const low = Number(bin.low);
    const high = Number(bin.high);
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      continue;
    }
    const top = priceY(Math.max(low, high), viewport);
    const bottom = priceY(Math.min(low, high), viewport);
    const bidWidth = half * (binWeight(bin, 'bid') / maxWeight);
    const askWidth = half * (binWeight(bin, 'ask') / maxWeight);
    maxBidWidth = Math.max(maxBidWidth, bidWidth);
    maxAskWidth = Math.max(maxAskWidth, askWidth);
    const binLow = Math.min(low, high);
    const binHigh = Math.max(low, high);
    const isPoc = !pocClaimed && pocValid && pocPrice >= binLow && pocPrice <= binHigh;
    if (isPoc) {
      pocClaimed = true;
    }
    rows.push({ top, bottom, bidWidth, askWidth, isPoc });
  }

  const profileLeft = anchorX - maxBidWidth;
  const profileRight = anchorX + maxAskWidth;
  const hit: FixedRangeProfileState['hit'] = { anchorX, profileLeft, profileRight };

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, viewport.chartRect.y, width, viewport.chartRect.height);
  ctx.clip();
  // Rows: BID extends LEFT from the anchor, ASK RIGHT; zero-weight sides
  // paint nothing (a zero-width rect would be an empty paint op).
  for (const row of rows) {
    const rowHeight = Math.max(1, row.bottom - row.top);
    // 1px gap between rows — never below 1px, so a 1px-tall bin still paints.
    const drawHeight = Math.max(1, rowHeight - 1);
    ctx.globalAlpha = row.isPoc ? POC_ROW_ALPHA : ROW_ALPHA;
    if (row.bidWidth > 0) {
      ctx.fillStyle = BID_COLOR;
      ctx.fillRect(anchorX - row.bidWidth, row.top, row.bidWidth, drawHeight);
    }
    if (row.askWidth > 0) {
      ctx.fillStyle = ASK_COLOR;
      ctx.fillRect(anchorX, row.top, row.askWidth, drawHeight);
    }
  }
  // Level lines AFTER the rows — range start (anchorX) → chartRect right
  // edge; POC solid, VAH/VAL dashed [4, 3]. No text labels (owner).
  ctx.globalAlpha = LEVEL_ALPHA;
  for (const def of levelDefs(profile)) {
    const lineY = levelY(def.raw, viewport);
    if (lineY === undefined) {
      continue;
    }
    ctx.strokeStyle = def.color;
    ctx.setLineDash(def.dash);
    ctx.beginPath();
    ctx.moveTo(anchorX, lineY);
    ctx.lineTo(x + width, lineY);
    ctx.stroke();
    ctx.setLineDash([]);
    hit[`${def.key}Y`] = lineY;
  }
  if (profile.source === 'bars' && profile.barTimeframe) {
    drawBarTimeframeLabel(ctx, viewport, anchorX, profile.barTimeframe, profile.coveredFromMs);
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
  drawProfileLoader(ctx, centerX, y + height / 2, nowMs, { bid: BID_COLOR, ask: ASK_COLOR, line: VA_COLOR });
}
