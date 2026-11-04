import type { RenderBar } from '../bars/renderBar';

export const PRICE_SOURCES = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4'] as const;

export type PriceSource = (typeof PRICE_SOURCES)[number];

export function isPriceSource(value: unknown): value is PriceSource {
  return typeof value === 'string' && PRICE_SOURCES.some((source) => source === value);
}

/** The price one bar plots for `source`; the three composite sources average the bar's own prices. */
export function priceAt(bar: RenderBar, source: PriceSource): number {
  switch (source) {
    case 'open':
      return bar.open;
    case 'high':
      return bar.high;
    case 'low':
      return bar.low;
    case 'close':
      return bar.close;
    case 'hl2':
      return (bar.high + bar.low) / 2;
    case 'hlc3':
      return (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4':
      return (bar.open + bar.high + bar.low + bar.close) / 4;
  }
}
