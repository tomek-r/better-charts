import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { timeframeLabel } from '../../shared/bridge/timeframes';
import { useBridgeSessionStores } from '../bridge/BridgeSessionProvider';
import { useHistoryWaitSecondsLeft } from './historyWaitCountdown';

/**
 * Tells the user why the chart is still empty while MT5 synchronizes the
 * requested series, and when it gave up. The live region is always mounted so
 * screen readers announce the text when it appears; it sits over the chart
 * only, never over the top bar, so the symbol search and timeframe buttons stay
 * usable.
 */
export function HistoryWaitNotice() {
  const stores = useBridgeSessionStores();
  const { startedAtMs, unavailable } = useStore(
    stores.market,
    useShallow((state) => ({ startedAtMs: state.historyWaitStartedAtMs, unavailable: state.historyUnavailable })),
  );
  const secondsLeft = useHistoryWaitSecondsLeft(startedAtMs);
  let text: string | undefined;
  if (unavailable) {
    text = `No data received for ${unavailable.symbol} ${timeframeLabel(unavailable.timeframe)}. Switch to another symbol or try again later.`;
  } else if (secondsLeft !== undefined) {
    text = `Loading is taking longer than usual. Waiting ${secondsLeft} s. If no data arrives, switch to another symbol.`;
  }
  return (
    <div className="chart-wait-notice" role="status" aria-live="polite">
      {text}
    </div>
  );
}
