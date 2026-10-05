import { timeframeOptions } from '../../shared/bridge/timeframes';
import { useBridgeActions, useBridgeChartState, useBridgeConnection } from '../bridge/BridgeSessionProvider';

export function ChartTimeframes() {
  const { symbol, timeframe, symbolLoading } = useBridgeChartState();
  const { status } = useBridgeConnection();
  const { requestHistory } = useBridgeActions();
  const disabled = !symbol || status.state !== 'connected' || symbolLoading;

  return (
    <div className="timeframe-tabs" role="group" aria-label="Chart timeframe">
      {timeframeOptions.map((option) => {
        const isActive = timeframe === option.wire;
        return (
          <button
            key={option.wire}
            className={isActive ? 'active' : ''}
            disabled={disabled}
            aria-pressed={isActive}
            onClick={() => void requestHistory(option.wire)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
