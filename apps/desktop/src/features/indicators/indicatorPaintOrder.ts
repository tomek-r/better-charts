import type { IndicatorPaintOrder } from '../chart/engine/indicators/indicatorLayer';
import { paintsUnderBars, type SavedIndicator } from '../chart/chartSettings/savedIndicators';
import { findChartIndicatorPlugin } from './registry';

/** Whether the indicator draws in the price pane, the one pane its prices share with the price bars. */
function drawsInPricePane(saved: SavedIndicator): boolean {
  return findChartIndicatorPlugin(saved.definitionId)?.pane === 'overlay';
}

/**
 * The price pane's paint order for the indicators the chart shows: the ones over the price bars first, then the ones
 * under them, each group in the saved order the object tree lists its rows in. An indicator of a pane of its own is
 * left out, because nothing in the price pane paints over or under it.
 */
export function indicatorPaintOrder(shown: readonly SavedIndicator[]): IndicatorPaintOrder {
  const pricePane = shown.filter(drawsInPricePane);
  const aboveBars = pricePane.filter((saved) => !paintsUnderBars(saved));
  const underBars = pricePane.filter(paintsUnderBars);
  return {
    topFirst: [...aboveBars, ...underBars].map((saved) => saved.instanceId),
    aboveBars: aboveBars.length,
  };
}
