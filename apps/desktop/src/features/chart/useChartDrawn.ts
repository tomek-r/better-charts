import { useBridgeMarketSelector, useTauriAvailable } from '../bridge/BridgeSessionProvider';

/** Candles on screen are the chart; without them there is nothing to draw. */
export function useChartDrawn(): boolean {
  const tauriAvailable = useTauriAvailable();
  const hasCandles = useBridgeMarketSelector(
    (market) => market.snapshot.candles.length > 0 || market.latestCandle !== undefined,
  );
  return tauriAvailable && hasCandles;
}
