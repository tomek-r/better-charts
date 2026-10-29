import { useBridgeMarketSelector } from '../bridge/bridgeSelectors';

/** Symbol the order ticket header names; `undefined` until the bridge reports one. */
export function useOrderTicketHeader(): string | undefined {
  return useBridgeMarketSelector((market) => market.snapshot.symbol);
}
