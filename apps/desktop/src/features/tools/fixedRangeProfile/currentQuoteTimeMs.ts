import type { ChartToolHost } from '../../chart/engine/tools/toolContract';

/** The broker-server time of the newest quote, when that quote is for the symbol on the chart now. */
export function currentQuoteTimeMs({ currentMarket }: ChartToolHost): number | undefined {
  const quote = currentMarket.quote();
  return quote && quote.symbol === currentMarket.symbol() && Number.isFinite(quote.timeMs) ? quote.timeMs : undefined;
}
