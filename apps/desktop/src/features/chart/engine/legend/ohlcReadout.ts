import type { IChartApi } from 'lightweight-charts';
import type { BarSeriesController } from '../bars/barSeriesController';
import { LegendCrosshair } from './legendCrosshair';
import { OhlcLegend } from './ohlcLegend';

/**
 * Keeps the OHLC line on the bar under the pointer: the crosshair reports the
 * logical index it sits on, and the legend prints that bar's values.
 */
export class OhlcReadout {
  private readonly legend: OhlcLegend;
  private readonly crosshair: LegendCrosshair;

  constructor(
    chart: IChartApi,
    host: HTMLElement,
    private readonly bars: Pick<BarSeriesController, 'legendBar' | 'pricePrecision'>,
    private readonly symbol: () => string,
  ) {
    this.legend = new OhlcLegend(host);
    this.crosshair = new LegendCrosshair(chart, () => this.refresh());
  }

  container(): HTMLElement {
    return this.legend.container();
  }

  refresh(): void {
    const shown = this.bars.legendBar(this.crosshair.logical());
    this.legend.apply(this.symbol(), shown?.bar, this.bars.pricePrecision, shown?.bodyColor ?? null);
  }

  destroy(): void {
    this.legend.destroy();
    this.crosshair.destroy();
  }
}
