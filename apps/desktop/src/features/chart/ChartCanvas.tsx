import { useBridgeChartState, useBridgeConnection } from '../bridge/BridgeSessionProvider';
import { useChartResources } from './ChartWorkspaceProvider';
import type { ReactNode } from 'react';
import { useErrorNotification } from '../../shared/ui/ErrorNotifications';
import { LoadingMessage } from '../../shared/ui/LoadingMessage';
import { HistoryWaitNotice } from './HistoryWaitNotice';

/** `children` are DOM overlays hung over the canvas (positioned against the chart frame). */
export function ChartCanvas({ children }: { children?: ReactNode }) {
  const { chartHost } = useChartResources();
  const { status, tauriAvailable } = useBridgeConnection();
  const { hasCandles, symbolLoading, chartError } = useBridgeChartState();
  const showLoadingMessage = !tauriAvailable || !hasCandles || symbolLoading;
  useErrorNotification(chartError);
  useErrorNotification(status.state === 'protocol_error' ? status.message : undefined);

  return (
    <div className="chart-frame">
      <div ref={chartHost} className="chart-host" aria-label="Market chart" tabIndex={0} />
      {children}
      {showLoadingMessage && <div className="chart-overlay" />}
      {/* Centered on the window, not on the chart frame, so it reads the same with the trade panel open or closed. */}
      <div className="viewport-center-layer">
        {showLoadingMessage && (
          <LoadingMessage
            title={symbolLoading ? 'Loading market data' : 'Waiting for market data'}
            hint="Connect MT5 bridge to load candles."
          />
        )}
        <HistoryWaitNotice />
      </div>
    </div>
  );
}
