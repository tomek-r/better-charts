import type { IChartApi, IPaneApi, PriceFormatBuiltIn, Time } from 'lightweight-charts';
import { IndicatorPaneOverlay } from './indicatorPaneOverlay';

/**
 * The stretch factor of an indicator pane the user has not resized. The library starts the price pane at a
 * factor of 2, so such a pane takes about a ninth of the chart's height.
 */
const OWN_PANE_STRETCH_FACTOR = 0.25;

/** The base of the smallest move a scale labels: one step of the last decimal the values are written with. */
const MIN_MOVE_BASE = 10;

/** The index of the price pane, where every overlay indicator draws. */
export const PRICE_PANE_INDEX = 0;

/** A pane an indicator holds of its own, with the overlay that borders it and holds its legend row. */
export interface OwnPane {
  readonly pane: IPaneApi<Time>;
  readonly overlay: IndicatorPaneOverlay;
}

/** The stretch factor the price pane holds now, which every own pane's height is measured against. */
export function pricePaneStretchFactor(chart: IChartApi): number {
  return chart.panes()[PRICE_PANE_INDEX]?.getStretchFactor() ?? 1;
}

/**
 * The stretch factor a new own pane is given: the height the user gave its indicator relative to the price
 * pane, or the default one while they never resized it.
 */
export function ownPaneStretchFactor(chart: IChartApi, paneHeight: number | undefined): number {
  if (paneHeight === undefined) {
    return OWN_PANE_STRETCH_FACTOR;
  }
  return paneHeight * pricePaneStretchFactor(chart);
}

/** Adds a pane under the ones already there, sized to the height its indicator was saved with. */
export function addOwnPane(chart: IChartApi, paneHeight: number | undefined): OwnPane {
  // The pane is kept while it holds no series, so showing the same indicator again reuses it.
  const pane = chart.addPane(true);
  pane.setStretchFactor(ownPaneStretchFactor(chart, paneHeight));
  // The library's separator crosses both price scales too, so the pane paints its own top border,
  // in the colour the appearance settings give the price scale's line.
  const overlay = new IndicatorPaneOverlay(() => chart.options().rightPriceScale.borderColor);
  pane.attachPrimitive(overlay);
  return { pane, overlay };
}

/** The index a series goes in now; nothing for an overlay, which the library draws on the price pane. */
export function paneIndexOf(ownPane: OwnPane | null): number | undefined {
  if (ownPane === null) {
    return undefined;
  }
  return ownPane.pane.paneIndex();
}

/** Gives a pane an indicator held back to the chart; the panes below it close up. */
export function removeOwnPane(chart: IChartApi, ownPane: OwnPane | null): void {
  if (ownPane === null) {
    return;
  }
  ownPane.pane.detachPrimitive(ownPane.overlay);
  chart.removePane(ownPane.pane.paneIndex());
}

/** The price format that writes an indicator's values with `precision` decimals; nothing when it states none. */
export function priceFormatOf(precision: number | null): PriceFormatBuiltIn | undefined {
  if (precision === null) {
    return undefined;
  }
  return { type: 'price', precision, minMove: MIN_MOVE_BASE ** -precision };
}
