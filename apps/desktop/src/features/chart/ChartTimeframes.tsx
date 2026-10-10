import { timeframeOptions } from '../../shared/bridge/timeframes';
import { useBridgeActions, useBridgeChartState, useBridgeConnection } from '../bridge/BridgeSessionProvider';

export function ChartTimeframes() {
  const { symbol, timeframe, symbolLoading } = useBridgeChartState();
  const { status } = useBridgeConnection();
  const { requestHistory } = useBridgeActions();
  const supported = status.supportedTimeframes ?? [];
  const disabled = !symbol || status.state !== 'connected' || symbolLoading;

  if (supported.length === 0) {
    // supportedTimeframes arrives with the handshake. Reserve the exact rows the
    // buttons will occupy (they wrap with the viewport width) using the same
    // buttons and styles, so no breakpoint-specific height can drift.
    return (
      <div className="timeframe-tabs placeholder" aria-hidden="true">
        {timeframeOptions.map((option) => (
          <button key={option.wire} disabled tabIndex={-1}>
            {option.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="timeframe-tabs" role="group" aria-label="Chart timeframe">
      {timeframeOptions
        .filter((option) => supported.includes(option.wire))
        .map((option) => {
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
