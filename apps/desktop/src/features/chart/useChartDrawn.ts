import { useHasCandles, useTauriAvailable } from '../bridge/bridgeSelectors';

/** Candles on screen are the chart; without them there is nothing to draw. */
export function useChartDrawn(): boolean {
  const tauriAvailable = useTauriAvailable();
  const hasCandles = useHasCandles();
  return tauriAvailable && hasCandles;
}
