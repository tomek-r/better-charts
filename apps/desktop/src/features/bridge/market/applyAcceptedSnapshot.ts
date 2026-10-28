import type { HistoryViewportMode } from '../../chart/engine/bars/historyViewportMode';
import type { ChartController } from '../../chart/engine/surface/chartController';
import type { Mt5DataAdapter } from '../../chart/engine/bars/mt5DataAdapter';
import type { MarketSnapshot } from '../../../shared/bridge/types';
import { DEFAULT_TIMEFRAME } from '../../../shared/bridge/timeframes';
import type { BridgeSessionState } from '../useBridgeSession';

export const NONE_VALID_CANDLES_MESSAGE = 'MT5 returned candles, but none of them contain valid OHLC values.';

type SnapshotTarget = {
  chart: { current: ChartController | null };
  adapter: Mt5DataAdapter | null | undefined;
  session: Pick<
    BridgeSessionState,
    'dataKeyRef' | 'currentSymbol' | 'currentTimeframe' | 'latestCandleRef' | 'setLatestCandle' | 'setChartError'
  >;
};

interface SnapshotOptions {
  /** How many candles the bridge sent before invalid ones were dropped. */
  receivedCandleCount: number;
  viewportMode: HistoryViewportMode;
  /** Runs once the chart shows the snapshot, before the chart error is settled. */
  afterReplace?: (dataKey: string) => void;
}

/** Puts a snapshot whose candles are already validated on screen and records it as the selection shown. */
export function applyAcceptedSnapshot(
  { chart: chartRef, adapter, session }: SnapshotTarget,
  accepted: MarketSnapshot,
  { receivedCandleCount, viewportMode, afterReplace }: SnapshotOptions,
): void {
  const { dataKeyRef, currentSymbol, currentTimeframe, latestCandleRef, setLatestCandle, setChartError } = session;
  adapter?.acceptSnapshot(accepted);
  const dataKey = `${accepted.symbol}:${accepted.timeframe}`;
  const replaced = dataKeyRef.current !== dataKey || (chartRef.current?.getData().length ?? 0) === 0;
  // Selection refs describe what is on screen, so set them before the swap:
  // a carried viewport can request an older page inside replaceHistory.
  dataKeyRef.current = dataKey;
  currentSymbol.current = accepted.symbol;
  currentTimeframe.current = accepted.timeframe;
  latestCandleRef.current = accepted.candles[accepted.candles.length - 1];
  setLatestCandle(latestCandleRef.current);
  chartRef.current?.setSymbol(accepted.symbol ?? '');
  const preserved =
    chartRef.current?.replaceHistory(accepted.candles, {
      timeframe: accepted.timeframe ?? DEFAULT_TIMEFRAME,
      viewportMode,
    }) ?? false;
  if (replaced && !preserved) {
    chartRef.current?.resetView();
  }
  afterReplace?.(dataKey);
  setChartError(receivedCandleCount > 0 && accepted.candles.length === 0 ? NONE_VALID_CANDLES_MESSAGE : undefined);
}
