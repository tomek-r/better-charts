import { useBridgeChartState, useBridgeConnection } from '../bridge/BridgeSessionProvider';
import { useChartResources } from './ChartWorkspaceProvider';

export function ChartCanvas() {
  const { chartHost } = useChartResources();
  const { status, tauriAvailable } = useBridgeConnection();
  const { hasCandles, symbolLoading, chartError } = useBridgeChartState();
  const waiting = !tauriAvailable || !hasCandles;

  return (
    <div className="chart-frame">
      <div ref={chartHost} className="chart-host" aria-label="Market chart" tabIndex={0} />
      {(waiting || symbolLoading) && (
        <div className="chart-overlay">
          <span className="overlay-glyph">◒</span>
          <strong>{symbolLoading ? 'Loading market data' : (chartError ?? 'Waiting for market data')}</strong>
          <span>{status.message ?? 'Connect MT5 bridge to load candles.'}</span>
        </div>
      )}
      {chartError && !waiting && !symbolLoading && (
        <div className="chart-error" role="alert">
          {chartError}
        </div>
      )}
    </div>
  );
}
