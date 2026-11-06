import { PriceScaleMode, type IRange } from 'lightweight-charts';
import { PRICE_SCALE_ID } from '../priceScale/priceScaleId';
import { setPriceScaleRange } from '../priceScale/priceScaleRange';
import type { OwnPane } from './indicatorPanes';

/** The choices made on an own pane's right scale: how it fits its prices, and the range a manual fit left. */
export interface OwnPaneScale {
  readonly autoScale: boolean;
  readonly mode: PriceScaleMode;
  /** The range the scale shows while it fits nothing itself; null while auto scale is on. */
  readonly visibleRange: IRange<number> | null;
}

/**
 * What an own pane's right scale holds as it opens: a pane fitting its own data on a regular scale, so its
 * `A` button opens pressed. The chart keeps auto scale off on its own `rightPriceScale`, so a pane left to
 * inherit would open unfitted.
 */
export const OPENING_OWN_PANE_SCALE: OwnPaneScale = {
  autoScale: true,
  mode: PriceScaleMode.Normal,
  visibleRange: null,
};

/** Reads the choices made on an own pane's right scale, so a reload can put them back afterwards. */
export function readOwnPaneScale(ownPane: OwnPane): OwnPaneScale {
  const priceScale = ownPane.pane.priceScale(PRICE_SCALE_ID);
  const options = priceScale.options();
  return {
    autoScale: options.autoScale,
    mode: options.mode,
    // A scale fitting its prices itself holds no range of its own, so there is none to keep.
    visibleRange: options.autoScale ? null : priceScale.getVisibleRange(),
  };
}

/**
 * Puts the choices `readOwnPaneScale` read back on an own pane's right scale, a held range through the
 * pane's first series. A reload draws the frame again from nothing, and the library forgets a scale with
 * no series: that, and not a choice of the user's, is what empties the scale in between.
 */
export function restoreOwnPaneScale(ownPane: OwnPane, scale: OwnPaneScale): void {
  const priceScale = ownPane.pane.priceScale(PRICE_SCALE_ID);
  priceScale.applyOptions({ autoScale: scale.autoScale, mode: scale.mode });
  const series = ownPane.pane.getSeries()[0];
  if (scale.visibleRange === null || series === undefined) {
    return;
  }
  setPriceScaleRange(series, scale.visibleRange);
}
