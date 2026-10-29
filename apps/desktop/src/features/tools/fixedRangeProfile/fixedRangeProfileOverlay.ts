import type { RenderViewport } from '../../chart/engine/surface/overlayRenderer';
import type { ProfileResult } from '../../../shared/bridge/types';
import { drawSeparatedText } from '../../../shared/canvas/separatedText';
import { palette } from '../../../shared/theme/palette';
import { isFullyTransparent } from '../../../shared/theme/hexColor';
import type { HandleEdges } from './drawing/handles';
import { drawProfileBars, layoutProfileBars, type ProfileBarsLayout } from './profileBars';
import type { FixedRangeProfileState } from './profileState';
import { drawProfileValueLabels, MAX_VALUE_FONT_PX, valueFont } from './profileValueLabels';
import { DEFAULT_FIXED_RANGE_PROFILE_APPEARANCE, type FixedRangeProfileAppearance } from './fixedRangeProfileSettings';

// Level lines keep the TAP look: same alpha.
const LEVEL_ALPHA = 0.95;

const BAR_LABEL_COLOR = palette.muted;
/** A profile whose history starts inside the range must not look complete. */
const BAR_LABEL_PARTIAL_COLOR = palette.warnText;
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAR_LABEL_FONT = valueFont(MAX_VALUE_FONT_PX);
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

/** The painted histogram box: the range box horizontally, the rows' price extent vertically. */
interface HistogramBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** The box to paint, or undefined when there are no rows, an edge is off the scale, or the colour is fully transparent. */
function histogramBoxOf(
  layout: ProfileBarsLayout,
  color: string,
  left: number,
  right: number,
): HistogramBox | undefined {
  if (layout.rows.length === 0 || isFullyTransparent(color)) {
    return undefined;
  }
  const top = Math.min(...layout.rows.map((row) => row.top));
  const bottom = Math.max(...layout.rows.map((row) => row.bottom));
  return [left, right, top, bottom].every(Number.isFinite) ? { left, right, top, bottom } : undefined;
}

function drawHistogramBox(ctx: CanvasRenderingContext2D, box: HistogramBox, color: string): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
  ctx.restore();
}

/** `20 Mar`: UTC day and short English month, independent of the browser locale. */
function formatUtcDayMonth(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]}`;
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

/**
 * The profile of the drawn range. The bars hang from the anchor line, the range start (placement left) or the range
 * end (placement right); Total and Delta grow inward, Up/Down mirrors around the line so one side leaves the range.
 * Everything is clipped to the pane only. `handles` gives the end x, which is otherwise the end of the requested
 * range.
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
  const box = histogramBoxOf(layout, appearance.histogramBoxColor, handles?.fromX ?? startX, endX);
  if (box !== undefined) {
    drawHistogramBox(ctx, box, appearance.histogramBoxColor);
    Object.assign(hit, { boxLeft: box.left, boxRight: box.right, boxTop: box.top, boxBottom: box.bottom });
  }
  drawProfileBars(ctx, anchorX, layout, appearance);
  const valueLabels = drawProfileValueLabels(ctx, anchorX, layout, appearance);
  hit.valueLabels = valueLabels.rowLabels;
  hit.summaryY = valueLabels.summaryY;
  if (valueLabels.box !== undefined) {
    const { left, right, top, bottom } = valueLabels.box;
    Object.assign(hit, { valuesBoxLeft: left, valuesBoxRight: right, valuesBoxTop: top, valuesBoxBottom: bottom });
  }
  hit.valueLabelX = valueLabels.textX;
  hit.valueLabelAlign = valueLabels.textAlign;
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
