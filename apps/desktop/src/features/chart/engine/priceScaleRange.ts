import { MismatchDirection, PriceScaleMode, type IRange, type ISeriesApi } from 'lightweight-charts';

/** Fits actual prices once, then holds the range independently of live ticks. */
export function setPriceScaleRange(series: ISeriesApi<'Candlestick'>, range: IRange<number>): void {
  const scale = series.priceScale();
  if (scale.options().mode !== PriceScaleMode.Logarithmic) {
    scale.setVisibleRange(range);
    return;
  }

  // LWC 5.2.1 writes manual ranges directly into internal log coordinates. Its
  // autoscale provider accepts actual prices and owns the log conversion.
  const provider = series.options().autoscaleInfoProvider;
  const last = series.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft);
  try {
    series.applyOptions({
      autoscaleInfoProvider: () => ({ priceRange: { minValue: range.from, maxValue: range.to } }),
    });
    scale.applyOptions({ autoScale: true });
    if (last !== null && 'open' in last) {
      // A scale held since startup may have no cached visible bars. Reapplying
      // the unchanged candle refreshes that cache through the public data API.
      series.update(last);
    }
    scale.getVisibleRange();
  } finally {
    scale.applyOptions({ autoScale: false });
    series.applyOptions({ autoscaleInfoProvider: provider });
  }
}
