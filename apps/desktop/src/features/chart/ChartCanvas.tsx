import { useBridgeChartState, useBridgeConnection } from '../bridge/bridgeSelectors';
import { useChartResources } from './ChartWorkspaceProvider';
import type { ReactNode } from 'react';
import { BridgeRefusal, bridgeRefusal } from '../../shared/bridge/bridgeRefusal';
import type { BridgeStatus } from '../../shared/bridge/types';
import { useErrorNotification } from '../../shared/ui/notification/ErrorNotifications';
import { LoadingMessage } from '../../shared/ui/loading/LoadingMessage';
import { HistoryWaitNotice } from './historyWait/HistoryWaitNotice';
import { useBridgeReconnectWait } from '../settings/setup/useBridgeReconnectWait';
import { useChartContextMenu } from './contextMenu/useChartContextMenu';
import { useResetChartViewShortcut } from './contextMenu/useResetChartViewShortcut';

/** A protocol error nothing else explains is the only thing worth a toast: the setup screen below covers a token
 * mismatch, an outdated component has its own notice, and a completed setup adds its fix to this same toast. */
function protocolErrorToNotify(status: BridgeStatus): string | undefined {
  if (bridgeRefusal(status) !== BridgeRefusal.Other) {
    return undefined;
  }
  return status.message;
}

interface LoadingCopy {
  title: string;
  hint: string;
}

const LOADING_MARKET_DATA: LoadingCopy = { title: 'Loading market data', hint: 'Loading candles from MetaTrader 5.' };

const RECONNECTING: LoadingCopy = {
  title: 'Reconnecting to MetaTrader 5…',
  hint: 'The chart updates as soon as the EA reconnects.',
};

/** Loading market data wins over reconnecting, so one message is ever on screen. */
function loadingCopy(loadingMarketData: boolean, reconnecting: boolean): LoadingCopy | undefined {
  if (loadingMarketData) {
    return LOADING_MARKET_DATA;
  }
  return reconnecting ? RECONNECTING : undefined;
}

/** `children` are DOM overlays hung over the canvas (positioned against the chart frame). */
export function ChartCanvas({ children }: { children?: ReactNode }) {
  const { chartHost } = useChartResources();
  const { status, tauriAvailable } = useBridgeConnection();
  const { hasCandles, symbolLoading, chartError } = useBridgeChartState();
  // A connected bridge is the only one with candles on the way; a missing one is the setup screen's case.
  const loadingMarketData = symbolLoading || (tauriAvailable && status.state === 'connected' && !hasCandles);
  const { loaderShown: reconnecting } = useBridgeReconnectWait();
  const loading = loadingCopy(loadingMarketData, reconnecting);
  useErrorNotification(chartError);
  useErrorNotification(protocolErrorToNotify(status));
  useResetChartViewShortcut();
  const { onContextMenu, menu } = useChartContextMenu();

  return (
    <div className="chart-frame" onContextMenu={onContextMenu}>
      <div ref={chartHost} className="chart-host" aria-label="Market chart" tabIndex={0} />
      {children}
      {menu}
      {loading && <div className="chart-overlay" />}
      {/* Centered on the window, not on the chart frame, so it reads the same with the trade panel open or closed. */}
      <div className="viewport-center-layer">
        {loading && <LoadingMessage title={loading.title} hint={loading.hint} />}
        <HistoryWaitNotice />
      </div>
    </div>
  );
}
