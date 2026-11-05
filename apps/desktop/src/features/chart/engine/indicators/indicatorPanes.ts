import type { IChartApi, IPaneApi, PriceFormatBuiltIn, Time } from 'lightweight-charts';
import { IndicatorPaneOverlay } from './indicatorPaneOverlay';

/**
 * The stretch factor of an indicator pane. The price pane keeps the library's default factor of 1,
 * so an indicator pane takes about a fifth of the chart's height.
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

/** Adds a pane under the ones already there, and sizes it for the single indicator it holds. */
export function addOwnPane(chart: IChartApi): OwnPane {
  // The pane is kept while it holds no series, so showing the same indicator again reuses it.
  const pane = chart.addPane(true);
  pane.setStretchFactor(OWN_PANE_STRETCH_FACTOR);
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
