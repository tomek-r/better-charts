import { PriceScaleMode, type IChartApi } from 'lightweight-charts';

/** The scale the candles and every pane's own prices are drawn against. */
const PRICE_SCALE_ID = 'right';

/** The price pane's scale as the dev test hook reports it: its shape, its geometry and its range. */
export interface PriceScaleReading {
  readonly autoScale: boolean;
  readonly mode: PriceScaleMode;
  readonly invertScale: boolean;
  readonly axisWidth: number;
  readonly paneHeight: number;
  readonly timeAxisHeight: number;
  readonly range: { from: number; to: number } | null;
}

/** One pane's own right scale: whether it fits the data itself and whether its prices are logarithmic. */
export interface PaneScaleReading {
  readonly autoScale: boolean;
  readonly logarithmic: boolean;
  readonly lowestVisiblePrice: number | null;
}

/** The price pane's scale, that pane's height and the time axis below it, as plain values. */
export function readPriceScale(chart: IChartApi): PriceScaleReading {
  const scale = chart.priceScale(PRICE_SCALE_ID);
  const options = scale.options();
  return {
    autoScale: options.autoScale,
    mode: options.mode,
    invertScale: options.invertScale,
    axisWidth: scale.width(),
    paneHeight: chart.panes()[0]?.getHeight() ?? 0,
    timeAxisHeight: chart.timeScale().height(),
    range: scale.getVisibleRange(),
  };
}

/** Pane `index`'s own right scale as plain values; null when the chart has no such pane. */
export function readPaneScale(chart: IChartApi, index: number): PaneScaleReading | null {
  const scale = chart.panes()[index]?.priceScale(PRICE_SCALE_ID);
  if (scale === undefined) {
    return null;
  }
  const options = scale.options();
  return {
    autoScale: options.autoScale,
    logarithmic: options.mode === PriceScaleMode.Logarithmic,
    lowestVisiblePrice: scale.getVisibleRange()?.from ?? null,
  };
}
