import { useBridgeChartState, useBridgeConnection } from '../bridge/BridgeSessionProvider';
import { useChartResources } from './ChartWorkspaceProvider';
import type { ReactNode } from 'react';
import { BridgeRefusal, bridgeRefusal } from '../../shared/bridge/bridgeRefusal';
import type { BridgeStatus } from '../../shared/bridge/types';
import { useErrorNotification } from '../../shared/ui/notification/ErrorNotifications';
import { LoadingMessage } from '../../shared/ui/loading/LoadingMessage';
import { HistoryWaitNotice } from './HistoryWaitNotice';

/** A protocol error nothing else explains is the only thing worth a toast: the setup screen below covers a token
 * mismatch, an outdated component has its own notice, and a completed setup adds its fix to this same toast. */
function protocolErrorToNotify(status: BridgeStatus): string | undefined {
  if (bridgeRefusal(status) !== BridgeRefusal.Other) {
    return undefined;
  }
  return status.message;
}

/** `children` are DOM overlays hung over the canvas (positioned against the chart frame). */
export function ChartCanvas({ children }: { children?: ReactNode }) {
  const { chartHost } = useChartResources();
  const { status, tauriAvailable } = useBridgeConnection();
  const { hasCandles, symbolLoading, chartError } = useBridgeChartState();
  // A connected bridge is the only one with candles on the way; a missing one is the setup screen's case.
  const showLoadingMessage = symbolLoading || (tauriAvailable && status.state === 'connected' && !hasCandles);
  useErrorNotification(chartError);
  useErrorNotification(protocolErrorToNotify(status));

  return (
    <div className="chart-frame">
      <div ref={chartHost} className="chart-host" aria-label="Market chart" tabIndex={0} />
      {children}
      {showLoadingMessage && <div className="chart-overlay" />}
      {/* Centered on the window, not on the chart frame, so it reads the same with the trade panel open or closed. */}
      <div className="viewport-center-layer">
        {showLoadingMessage && <LoadingMessage title="Loading market data" hint="Loading candles from MetaTrader 5." />}
        <HistoryWaitNotice />
      </div>
    </div>
  );
}
