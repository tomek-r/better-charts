import type { OverlayRenderer, RenderViewport } from './overlayTypes';
import type { ProfileResult, TickProfileBin } from '../../../shared/bridge/types';
import { palette } from '../../../shared/theme/palette';

/** Mirrored BID/ASK profile, below trading labels; levels carry no labels. */
export interface FixedRangeProfileState {
  /** null/undefined = no active selection — the overlay renders nothing. */
  range?: { fromMs: number; toMs: number } | null;
  /** Profile computed for exactly `range` (Rust side, wire types). */
  profile?: ProfileResult;
  /** A boundary preview hides the result until release or cancellation. */
  previewing?: boolean;
  /** Painted geometry from the last frame (dev hook / tests). */
  hit: { anchorX?: number; profileLeft?: number; profileRight?: number; pocY?: number; vahY?: number; valY?: number };
}

// The app's sell/buy convention (stagedOrderOverlay STAGED_COLORS): the bid is
// what you SELL at (red, mirrored LEFT), the ask what you BUY at (blue, RIGHT).
const BID_COLOR = palette.sell;
const ASK_COLOR = palette.buy;
const POC_COLOR = palette.profilePoc;
const VA_COLOR = palette.textBright;
const ROW_ALPHA = 0.75;
const POC_ROW_ALPHA = 1;
// Level lines keep the TAP look: same alpha.
const LEVEL_ALPHA = 0.95;

// Weights arrive as decimal strings (§8) but are parsed defensively, exactly
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

export function createFixedRangeProfileOverlay(state: FixedRangeProfileState): OverlayRenderer {
  return {
    descriptor: { id: 'fixed-range-profile', name: 'Fixed Range Volume Profile', layer: 'overlay' },
    render(ctx, { viewport }) {
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
      ctx.restore();
      state.hit = hit;
    },
  };
}
