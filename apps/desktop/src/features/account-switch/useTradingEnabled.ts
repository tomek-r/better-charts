import { useBridgeConnectionSelector } from '../bridge/bridgeSelectors';

/** Algo-trading permission the connected EA advertised; display only, never a dispatch gate. */
export function useTradingEnabled(): boolean {
  return useBridgeConnectionSelector(({ status }) => status.tradingEnabled === true);
}
