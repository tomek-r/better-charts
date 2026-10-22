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
  // Candles on screen are the chart; without them the connection dot has nothing to describe.
  const chartRendered = tauriAvailable && hasCandles;
  // A connected bridge is the only one with candles on the way; a missing one is the setup screen's case.
  const showLoadingMessage = symbolLoading || (tauriAvailable && status.state === 'connected' && !hasCandles);
  const frameClassName = chartRendered ? 'chart-frame' : 'chart-frame chart-frame-waiting';
  useErrorNotification(chartError);
  // An outdated EA or tick reader is reported by the header notice instead, which carries the same message
  // plus the install action.
  useErrorNotification(
    status.state === 'protocol_error' && status.componentOutdated !== true ? status.message : undefined,
  );

  return (
    <div className={frameClassName}>
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
