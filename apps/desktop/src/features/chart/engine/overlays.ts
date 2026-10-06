import type { TradingLabelLayoutState } from './labelLayout';
import { createTradingLabelsOverlay } from './tradingLabelsOverlay';
import type { OverlayRenderer } from './overlayTypes';
import { createFixedRangeProfileOverlay, type FixedRangeProfileState } from './fixedRangeProfileOverlay';
import { createPositionOverlay, type PositionOverlayState } from './positionOverlay';
import { createStagedOrderOverlay, type StagedOrderState } from './stagedOrderOverlay';
import { createPriceLinesOverlay, type PriceLinesState } from './priceLinesOverlay';

/** Live state holders App feeds the four chart overlays with (refs). */
export interface ChartOverlayState {
  fixedRangeProfile: FixedRangeProfileState;
  positions: PositionOverlayState;
  staged: StagedOrderState;
  priceLines: PriceLinesState;
}

/**
 * Z-INDEX CONTRACT: the chart paints `ui`-layer plugins in REGISTRATION order
 * (the package filters `pluginManager.getOverlays()` per layer), so THIS ARRAY
 * is the z-order of every risk zone and label on the chart. Three rules:
 *
 * 1. Native Lightweight Charts price lines (bid/ask, entry, SL, TP) and their
 *    axis labels render below this primitive. Risk-zone fills paint before row
 *    labels (✕ chips, pills, handles and qty), so `lines` passes precede
 *    `labels` passes.
 * 2. Among row surfaces later registrations win: position/order rows under
 *    the staged draft row (the active draft is the primary surface). Native
 *    price-line axis labels are drawn by Lightweight Charts below this layer.
 * 3. Trading rows are laid out together in the final pass to avoid collisions.
 *
 * Plugin ids carry the pass suffix because the plugin registry is keyed by id.
 */
export function buildChartPlugins(state: ChartOverlayState): Array<{ kind: 'overlay'; plugin: OverlayRenderer }> {
  const labels: TradingLabelLayoutState = { pending: [] };
  return [
    { kind: 'overlay', plugin: createFixedRangeProfileOverlay(state.fixedRangeProfile) },
    // ── lines passes: risk zones (native price lines are managed by PriceLineController).
    { kind: 'overlay', plugin: createPriceLinesOverlay(state.priceLines, 'lines') },
    { kind: 'overlay', plugin: createPositionOverlay(state.positions, 'lines') },
    { kind: 'overlay', plugin: createStagedOrderOverlay(state.staged, 'lines') },
    // ── labels passes: ✕ chips, side pills, handles and qty.
    { kind: 'overlay', plugin: createPriceLinesOverlay(state.priceLines, 'labels') },
    { kind: 'overlay', plugin: createPositionOverlay(state.positions, 'labels', labels) },
    { kind: 'overlay', plugin: createStagedOrderOverlay(state.staged, 'labels', labels) },
    { kind: 'overlay', plugin: createTradingLabelsOverlay(labels) },
  ];
}
