import type { RenderViewport } from '../../chart/engine/surface/overlayRenderer';
import type { ProfileResult, TickProfileBin } from '../../../shared/bridge/types';
import type {
  FixedRangeProfileAppearance,
  FixedRangeProfilePlacement,
  FixedRangeProfileVolumeMode,
} from './fixedRangeProfileSettings';

const ROW_ALPHA = 0.75;
const POC_ROW_ALPHA = 1;

/** Which way a one-sided bar grows from its anchor: right from the range start, left from the range end. */
type Growth = 1 | -1;

const GROWTH_BY_PLACEMENT: Readonly<Record<FixedRangeProfilePlacement, Growth>> = { left: 1, right: -1 };

/** One painted piece of a row: the pane x span relative to the anchor, and the side whose colour it takes. */
interface BarSegment {
  readonly from: number;
  readonly to: number;
  readonly side: 'up' | 'down';
}

export interface RowWeights {
  readonly up: number;
  readonly down: number;
}

interface ProfileRow {
  readonly top: number;
  readonly bottom: number;
  /** The bin containing profile.poc: paints at full alpha. */
  readonly isPoc: boolean;
  readonly weights: RowWeights;
  readonly segments: readonly BarSegment[];
}

/** The rows of one profile and how far they reach either side of the anchor, as offsets in pane px. */
export interface ProfileBarsLayout {
  readonly rows: readonly ProfileRow[];
  readonly reachLeft: number;
  readonly reachRight: number;
}

/** Turns a weight into a bar length in px. */
type WeightLength = (weight: number) => number;

/** How a row's bars are measured: weight to length and the growth direction. */
interface BarGeometry {
  readonly lengthOf: WeightLength;
  readonly growth: Growth;
}

interface VolumeLayout {
  /**
   * The share of the histogram's extent the longest bar may take: a mirrored profile spends it on both sides, so
   * each side gets half, and a row with the maximum on both sides spans the whole extent.
   */
  longestBarShare: number;
  /** The weight of the row's longest bar: the largest of these over all rows is what a full-length bar stands for. */
  barWeight(weights: RowWeights): number;
  segments(weights: RowWeights, geometry: BarGeometry): BarSegment[];
}

/** The span `[start, end]` measured along the growth direction, as an offset from the anchor. */
function outward(start: number, end: number, growth: Growth, side: BarSegment['side']): BarSegment {
  return growth === 1 ? { from: start, to: end, side } : { from: -end, to: -start, side };
}

const VOLUME_LAYOUTS: Readonly<Record<FixedRangeProfileVolumeMode, VolumeLayout>> = {
  // The anchor line is the mirror axis: down to its left, up to its right, so one side leaves the range.
  upDown: {
    longestBarShare: 0.5,
    barWeight: ({ up, down }) => Math.max(up, down),
    segments: ({ up, down }, { lengthOf }) => [
      { from: -lengthOf(down), to: 0, side: 'down' },
      { from: 0, to: lengthOf(up), side: 'up' },
    ],
  },
  // The down part first, the up part stacked after it.
  total: {
    longestBarShare: 1,
    barWeight: ({ up, down }) => up + down,
    segments: ({ up, down }, { lengthOf, growth }) => [
      outward(0, lengthOf(down), growth, 'down'),
      outward(lengthOf(down), lengthOf(up + down), growth, 'up'),
    ],
  },
  delta: {
    longestBarShare: 1,
    barWeight: ({ up, down }) => Math.abs(up - down),
    segments: ({ up, down }, { lengthOf, growth }) => [
      outward(0, lengthOf(Math.abs(up - down)), growth, up >= down ? 'up' : 'down'),
    ],
  },
};

// Weights arrive as decimal strings but are parsed defensively, exactly like tickActivityOverlay's
// binWeight: invalid or non-positive counts as 0.
function binWeight(bin: TickProfileBin, side: 'bid' | 'ask'): number {
  const value = Number(bin[side]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** A bid weight is the down volume, an ask weight the up volume. */
function weightsOf(bin: TickProfileBin): RowWeights {
  return { up: binWeight(bin, 'ask'), down: binWeight(bin, 'bid') };
}

/**
 * The rows of a profile at the viewport's price scale. One COMMON denominator covers every row so
 * dominance is comparable; the floor of 1 only matters when every weight is 0. The histogram's widest
 * extent is the width setting's share of `rangeWidth`, the px between the range's two handles, and the
 * Total and Delta bars grow inward from the anchor; Up/Down bars mirror around the anchor line, so one side of
 * them extends outside the range.
 */
export function layoutProfileBars(
  profile: ProfileResult,
  viewport: RenderViewport,
  appearance: FixedRangeProfileAppearance,
  rangeWidth: number,
): ProfileBarsLayout {
  const layout = VOLUME_LAYOUTS[appearance.volumeMode];
  const growth = GROWTH_BY_PLACEMENT[appearance.placement];
  const histogramExtent = rangeWidth * (appearance.widthPercent / 100);
  const longestBarLength = histogramExtent * layout.longestBarShare;
  const maxWeight = profile.bins.reduce((largest, bin) => Math.max(largest, layout.barWeight(weightsOf(bin))), 1);
  const geometry: BarGeometry = {
    lengthOf: (weight) => longestBarLength * (weight / maxWeight),
    growth,
  };

  const pocPrice = Number(profile.poc);
  const pocValid = Number.isFinite(pocPrice);
  let pocClaimed = false;
  let reachLeft = Number.POSITIVE_INFINITY;
  let reachRight = Number.NEGATIVE_INFINITY;
  const rows: ProfileRow[] = [];
  for (const bin of profile.bins) {
    const low = Number(bin.low);
    const high = Number(bin.high);
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      continue;
    }
    const binLow = Math.min(low, high);
    const binHigh = Math.max(low, high);
    const isPoc = !pocClaimed && pocValid && pocPrice >= binLow && pocPrice <= binHigh;
    if (isPoc) {
      pocClaimed = true;
    }
    const weights = weightsOf(bin);
    const segments = layout.segments(weights, geometry);
    for (const { from, to } of segments) {
      reachLeft = Math.min(reachLeft, from);
      reachRight = Math.max(reachRight, to);
    }
    rows.push({ top: viewport.priceToY(binHigh), bottom: viewport.priceToY(binLow), isPoc, weights, segments });
  }
  // Nothing painted reaches nowhere: the extent collapses onto the anchor.
  return rows.length === 0 ? { rows, reachLeft: 0, reachRight: 0 } : { rows, reachLeft, reachRight };
}

/** Paints the rows hanging from `anchorX`; a side without volume paints nothing (a zero-width rect is an empty op). */
export function drawProfileBars(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  { rows }: ProfileBarsLayout,
  appearance: FixedRangeProfileAppearance,
): void {
  const colorOf = { up: appearance.upColor, down: appearance.downColor };
  for (const row of rows) {
    const rowHeight = Math.max(1, row.bottom - row.top);
    // 1px gap between rows, never below 1px, so a 1px-tall bin still paints.
    const drawHeight = Math.max(1, rowHeight - 1);
    ctx.globalAlpha = row.isPoc ? POC_ROW_ALPHA : ROW_ALPHA;
    for (const { from, to, side } of row.segments) {
      if (to > from) {
        ctx.fillStyle = colorOf[side];
        ctx.fillRect(anchorX + from, row.top, to - from, drawHeight);
      }
    }
  }
}
