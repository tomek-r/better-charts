import { useBridgeChartState } from '../bridge/BridgeSessionProvider';

export function ChartTitle() {
  const { symbol, symbolLoading, description } = useBridgeChartState();

  return (
    <div className="chart-title">
      <p className="eyebrow">MARKET DATA</p>
      <div className="chart-symbol">
        <h1>{symbolLoading ? 'Loading symbol…' : (symbol ?? 'Waiting for symbol')}</h1>
        {!symbolLoading && symbol && description && <span className="chart-symbol-description">{description}</span>}
      </div>
    </div>
  );
}
