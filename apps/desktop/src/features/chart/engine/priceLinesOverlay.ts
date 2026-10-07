import type { OverlayRenderer } from './overlayTypes';
import type { OverlayPass } from './stagedOrderOverlay';

/**
 * LIVE bid/ask price lines (owner request: "for CFDs I also want to see bid,
 * so show two lines side by side, like in TradingView"). The library paints
 * exactly one current-price line, which is disabled through the public series
 * options; PriceLineController owns the native Lightweight Charts price lines
 * for both sides.
 *
 * Lightweight Charts renders both the line and its matching price-axis label.
 * The overlay retains only hit geometry used by the development diagnostics.
 */
export interface PriceLinesState {
  ask?: number;
  bid?: number;
  /** Instrument digits mirrored for chart precision synchronization. */
  digits: number;
  /** Quote y coordinates in chart frame; the dev hook reads them. */
  hit: { askY?: number; bidY?: number };
}

export function createPriceLinesOverlay(state: PriceLinesState, pass: OverlayPass): OverlayRenderer {
  return {
    // This overlay retains diagnostic geometry; Lightweight Charts owns the
    // visible lines and price-axis labels.
    descriptor: { id: `price-lines-${pass}`, name: `Bid/Ask Lines (${pass})`, layer: 'ui' },
    render(_ctx, { viewport }) {
      const { y, width, height } = viewport.chartRect;
      const hit: PriceLinesState['hit'] = {};
      if (width <= 0 || height <= 0) {
        state.hit = hit;
        return;
      }
      const toY = viewport.priceToY;
      const line = (price: number | undefined): number | undefined => {
        if (price === undefined || !Number.isFinite(price) || price <= 0) {
          return undefined;
        }
        const py = toY(price);
        // Self-clip: outside the visible price range there is no line to draw.
        if (py < y || py > y + height) {
          return undefined;
        }
        return py;
      };
      const askY = line(state.ask);
      const bidY = line(state.bid);
      hit.askY = askY;
      hit.bidY = bidY;
      state.hit = hit;
    },
  };
}
