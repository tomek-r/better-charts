import { useBridgeConnectionSelector, useHasCandles } from './bridgeSelectors';

/**
 * Whether the workspace has no chart to draw: without Tauri the bridge is unreachable, and without
 * candles on a bridge that has not connected there is nothing to draw yet. Each half is its own
 * primitive subscription, so a heartbeat — which replaces the status object every time — and a
 * candle tick that leave the answer unchanged reach no screen.
 */
export function useChartCannotBeDrawn(): boolean {
  const { tauriAvailable, connected } = useBridgeConnectionSelector(({ status, tauriAvailable }) => ({
    tauriAvailable,
    connected: status.state === 'connected',
  }));
  const hasCandles = useHasCandles();
  if (!tauriAvailable) {
    return true;
  }
  return !hasCandles && !connected;
}
