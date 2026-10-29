import type { TradingLabelLayoutState } from '../trading/labels/tradingLabelTypes';
import { createTradingLabelsOverlay } from '../trading/labels/tradingLabelsOverlay';
import type { OverlayRenderer } from './overlayRenderer';
import { createPositionOverlay } from '../trading/positionOverlay';
import type { PositionOverlayState } from '../trading/positionOverlayTypes';
import { createStagedOrderOverlay, type StagedOrderState } from '../trading/stagedOrderOverlay';
import { createPriceLinesOverlay, type PriceLinesState } from '../quotes/priceLinesOverlay';

/** Live state holders App feeds the chart overlays with (refs). */
export interface ChartOverlayState {
  positions: PositionOverlayState;
  staged: StagedOrderState;
  priceLines: PriceLinesState;
}

/**
 * The paint order of every trading and quote overlay. `WorkspacePrimitive` paints the
 * drawing tools first and then calls `render` on these renderers in array order, so
 * THIS ARRAY is the z-order of every risk zone and label on the chart:
 *
 * 1. Native Lightweight Charts price lines (bid/ask, entry, SL, TP) and their axis
 *    labels render below this primitive.
 * 2. Every `lines` pass (risk-zone fills) precedes every `labels` pass (✕ chips, pills,
 *    handles and qty), so fills never cover a row label.
 * 3. Among row surfaces the later entry wins: position/order rows sit under the staged
 *    draft row, which is the primary surface.
 * 4. Trading rows are laid out together in the final pass to avoid collisions.
 *
 * Each renderer's `id` carries its pass suffix so the z-order test can name it.
 */
export function buildChartPlugins(state: ChartOverlayState): readonly OverlayRenderer[] {
  const labels: TradingLabelLayoutState = { pending: [] };
  return [
    // ── lines passes: risk zones (native price lines are managed by PriceLineController).
    createPriceLinesOverlay(state.priceLines, 'lines'),
    createPositionOverlay(state.positions, 'lines'),
    createStagedOrderOverlay(state.staged, 'lines'),
    // ── labels passes: ✕ chips, side pills, handles and qty.
    createPriceLinesOverlay(state.priceLines, 'labels'),
    createPositionOverlay(state.positions, 'labels', labels),
    createStagedOrderOverlay(state.staged, 'labels', labels),
    createTradingLabelsOverlay(labels),
  ];
}
