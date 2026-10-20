import { useBridgeMarketSelector } from '../../bridge/BridgeSessionProvider';

/** Symbol the order ticket header names; `undefined` until the bridge reports one. */
export function useOrderTicketHeader(): string | undefined {
  return useBridgeMarketSelector((market) => market.snapshot.symbol);
}
