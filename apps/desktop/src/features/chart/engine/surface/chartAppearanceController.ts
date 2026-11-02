import type { IChartApi } from 'lightweight-charts';
import { opaqueHexColor } from '../../../../shared/theme/hexColor';
import type { PriceScaleController } from '../priceScale/priceScaleController';
import type { ViewportController } from '../viewport/viewportController';
import {
  chartLayoutOptions,
  DEFAULT_CHART_APPEARANCE,
  priceScaleMargins,
  sameChartAppearance,
  type ChartAppearance,
  type ChartSizedLineAppearance,
} from './chartAppearance';

/**
 * Owns how the chart itself is painted, which is what the settings dialog's Canvas tab sets: the
 * appearance in force, and the writes that put it on the chart, on the price scale's margins, on
 * the pane's right margin, on the price scale toggles' mask and on the pointer's crosshair.
 *
 * The surface is built from `DEFAULT_CHART_APPEARANCE`, so an untouched setting costs no write.
 */
export class ChartAppearanceController {
  private appearance: ChartAppearance = DEFAULT_CHART_APPEARANCE;

  constructor(
    private readonly chart: IChartApi,
    private readonly pane: Pick<ViewportController, 'setRightMargin'>,
    private readonly priceScale: Pick<PriceScaleController, 'setMaskColor'>,
  ) {}

  /**
   * Paints the chart itself with the Canvas tab's settings: background, both grids, scale text and
   * lines, price margins and the empty bars to the right of the last one. Returns false, writing
   * nothing, while `appearance` is the one already in force.
   */
  apply(appearance: ChartAppearance): boolean {
    if (sameChartAppearance(appearance, this.appearance)) {
      return false;
    }
    this.appearance = appearance;
    this.chart.applyOptions(chartLayoutOptions(appearance));
    this.chart.applyOptions({ rightPriceScale: { scaleMargins: priceScaleMargins(appearance) } });
    this.pane.setRightMargin(appearance.rightMarginBars);
    this.paintPriceScaleMask(appearance.background.color);
    return true;
  }

  /** The colour, dash and thickness of the pointer's crosshair lines, which every tool draws the pointer with. */
  crosshairStyle(): ChartSizedLineAppearance {
    return this.appearance.crosshair;
  }

  /**
   * Fills the A/L row with the chart's background, which masks the axis labels behind it, so the
   * fill is made opaque: a translucent background would let the labels show through.
   */
  private paintPriceScaleMask(color: string): void {
    if (color === DEFAULT_CHART_APPEARANCE.background.color) {
      // The stock background needs no inline fill: the row's own CSS default is already opaque.
      this.priceScale.setMaskColor(null);
      return;
    }
    const opaque = opaqueHexColor(color);
    if (opaque !== undefined) {
      this.priceScale.setMaskColor(opaque);
    }
  }
}
