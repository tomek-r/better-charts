import type { ProfileResult } from '../../src/shared/bridge/types';
import {
  createMarketDataConnection,
  type MarketDataPort,
  type TickProfileRequest,
} from '../../src/features/bridge/marketDataPort';

/**
 * A `MarketDataPort` for Node-run specs: it records the requests a tool sends and lets
 * the spec publish result events. Subscriptions use the real event channels.
 */
export function createFakeMarketDataPort() {
  const connection = createMarketDataConnection();
  const requests: TickProfileRequest[] = [];
  let cancelCount = 0;
  const port: MarketDataPort = {
    ...connection.port,
    requestTickProfile: (request) => {
      requests.push(request);
    },
    cancelTickProfile: () => {
      cancelCount += 1;
    },
  };
  return { port, publisher: connection.publisher, requests, cancelCount: () => cancelCount };
}

/** A finished, empty profile result for the window `[fromMs, endMs)`. */
export function profileResultFor({ fromMs, endMs }: { fromMs: number; endMs: number }, symbol: string): ProfileResult {
  return {
    symbol,
    fromMs,
    endMs,
    complete: true,
    rejectedTicks: 0,
    actualRows: 0,
    totalWeight: 0,
    poc: '1',
    vah: '1',
    val: '1',
    bidLevels: null,
    askLevels: null,
    bins: [],
  };
}
