import { useBridgeChartState, useBridgeConnection } from '../bridge/BridgeSessionProvider';
import { useChartResources } from './ChartWorkspaceProvider';
import type { ReactNode } from 'react';
import { useErrorNotification } from '../../shared/ui/ErrorNotifications';

/** `children` are DOM overlays hung over the canvas (positioned against the chart frame). */
export function ChartCanvas({ children }: { children?: ReactNode }) {
  const { chartHost } = useChartResources();
  const { status, tauriAvailable } = useBridgeConnection();
  const { symbol, hasCandles, symbolLoading, historyDownloading, chartError } = useBridgeChartState();
  const waiting = !tauriAvailable || !hasCandles;
  useErrorNotification(chartError);
  useErrorNotification(status.state === 'protocol_error' ? status.message : undefined);

  return (
    <div className="chart-frame">
      <div ref={chartHost} className="chart-host" aria-label="Market chart" tabIndex={0} />
      {children}
      {(waiting || symbolLoading) && (
        <div className="chart-overlay">
          <span className="overlay-glyph">◒</span>
          <strong>{symbolLoading ? 'Loading market data' : 'Waiting for market data'}</strong>
          <span>Connect MT5 bridge to load candles.</span>
        </div>
      )}
      {historyDownloading && !waiting && !symbolLoading && (
        <div className="chart-overlay" role="status" aria-live="polite">
          <span className="overlay-glyph">◒</span>
          <strong>Downloading history…</strong>
          <span>{symbol} is still synchronizing in MT5.</span>
        </div>
      )}
    </div>
  );
}
