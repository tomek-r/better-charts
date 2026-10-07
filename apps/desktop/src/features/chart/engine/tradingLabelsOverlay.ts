import { layoutLabelCenters, type TradingLabelLayoutState } from './labelLayout';
import type { OverlayRenderer } from './overlayTypes';

/** Final labels pass: both trading overlays queue rows, then this plugin
 * spaces and paints them together. Price lines and risk zones stay put. */
export function createTradingLabelsOverlay(state: TradingLabelLayoutState): OverlayRenderer {
  return {
    descriptor: { id: 'trading-labels', name: 'Spaced trading labels', layer: 'ui' },
    render(_ctx, { viewport }) {
      const rows = state.pending;
      state.pending = [];
      rows.sort(
        (a, b) =>
          a.y - b.y ||
          `${a.target.source}:${a.target.id}:${a.target.level}`.localeCompare(
            `${b.target.source}:${b.target.id}:${b.target.level}`,
          ),
      );
      const { y, height } = viewport.chartRect;
      const centres = layoutLabelCenters(
        rows.map((row) => row.y),
        y,
        y + height,
      );
      rows.forEach((row, i) => row.draw(centres[i]));
    },
  };
}
