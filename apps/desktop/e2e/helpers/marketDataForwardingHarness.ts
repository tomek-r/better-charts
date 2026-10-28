import { createBridgeMarketRuntime, type BridgeEffectRun } from '../../src/features/bridge/market/bridgeMarketRuntime';
import { createMarketDataConnection } from '../../src/features/bridge/marketDataPort';
import type { BridgeMarketResources } from '../../src/features/bridge/market/bridgeMarketRuntime';

/**
 * Starts the market runtime's event forwarding on its own run and records what reaches the
 * market data port. `run.disposed = true` stands in for the effect run ending.
 */
export async function startMarketDataForwarding() {
  const connection = createMarketDataConnection();
  const received: string[] = [];
  connection.port.onTickProfile((profile) => received.push(`profile:${profile.symbol}`));
  connection.port.onTickProfileCancelled((event) => received.push(`cancelled:${event.symbol}`));
  connection.port.onTickProfileError((event) => received.push(`error:${event.symbol}`));
  const run: BridgeEffectRun = { disposed: false, bridgeState: 'connected' };
  // Forwarding only touches the publisher; the rest of the session is not read here.
  const session = { marketData: connection } as unknown as Parameters<typeof createBridgeMarketRuntime>[1];
  const resources: BridgeMarketResources = { chart: { current: null }, adapterRef: { current: null } };
  const runtime = createBridgeMarketRuntime(run, session, resources);
  const releases = await Promise.all(runtime.forwardMarketDataEvents());
  return {
    received,
    endRun: () => {
      run.disposed = true;
    },
    stopListening: () => releases.forEach((release) => release()),
  };
}
