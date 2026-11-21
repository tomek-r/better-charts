import { HistoryViewportMode } from '../../chart/engine/bars/historyViewportMode';
import type { ChartController } from '../../chart/engine/surface/chartController';
import type { Mt5DataAdapter } from '../../chart/engine/bars/mt5DataAdapter';
import type { MarketSnapshot } from '../../../shared/bridge/types';
import { DEFAULT_TIMEFRAME } from '../../../shared/bridge/timeframes';
import { isTickInterval } from '../../../shared/bridge/chartIntervals';
import type { BridgeSessionState } from '../useBridgeSession';

export const NONE_VALID_CANDLES_MESSAGE = 'MT5 returned candles, but none of them contain valid OHLC values.';

type SnapshotTarget = {
  chart: { current: ChartController | null };
  adapter: Mt5DataAdapter | null | undefined;
  session: Pick<
    BridgeSessionState,
    | 'dataKeyRef'
    | 'currentSymbol'
    | 'currentTimeframe'
    | 'latestCandleRef'
    | 'setLatestCandle'
    | 'setChartError'
    | 'mt5TimeframeRef'
  >;
};

interface SnapshotOptions {
  /** How many candles the bridge sent before invalid ones were dropped. */
  receivedCandleCount: number;
  viewportMode: HistoryViewportMode;
  /** Runs once the chart shows the snapshot, before the chart error is settled. */
  afterReplace?: (dataKey: string) => void;
}

/**
 * Where the pane goes after a replacement of the series: the same symbol keeps
 * the view it had, because the newest bar may sit several bars later, while a
 * new symbol starts from the default one.
 */
export function snapshotViewportMode(
  shownSymbol: string | undefined,
  hasBars: boolean,
  symbol: string | undefined,
): HistoryViewportMode {
  return shownSymbol === symbol && hasBars ? HistoryViewportMode.BarsFromEnd : HistoryViewportMode.Reset;
}

/**
 * Records the MT5 series on screen: the series a symbol switch or a saved window
 * asks the bridge for while a tick interval is shown.
 */
export function recordMt5Timeframe(mt5Timeframe: { current: string }, timeframe: string | undefined): void {
  const series = timeframe ?? DEFAULT_TIMEFRAME;
  // A tick interval is drawn from ticks: it is never a window a symbol switch could request.
  if (!isTickInterval(series)) {
    mt5Timeframe.current = series;
  }
}

/** Puts a snapshot whose candles are already validated on screen and records it as the selection shown. */
export function applyAcceptedSnapshot(
  { chart: chartRef, adapter, session }: SnapshotTarget,
  accepted: MarketSnapshot,
  { receivedCandleCount, viewportMode, afterReplace }: SnapshotOptions,
): void {
  const {
    dataKeyRef,
    currentSymbol,
    currentTimeframe,
    mt5TimeframeRef,
    latestCandleRef,
    setLatestCandle,
    setChartError,
  } = session;
  adapter?.acceptSnapshot(accepted);
  recordMt5Timeframe(mt5TimeframeRef, accepted.timeframe);
  const timeframe = accepted.timeframe ?? DEFAULT_TIMEFRAME;
  const dataKey = `${accepted.symbol}:${timeframe}`;
  const replaced = dataKeyRef.current !== dataKey || (chartRef.current?.getData().length ?? 0) === 0;
  // Selection refs describe what is on screen, so set them before the swap:
  // a carried viewport can request an older page inside replaceHistory.
  dataKeyRef.current = dataKey;
  currentSymbol.current = accepted.symbol;
  currentTimeframe.current = timeframe;
  latestCandleRef.current = accepted.candles[accepted.candles.length - 1];
  setLatestCandle(latestCandleRef.current);
  chartRef.current?.setSymbol(accepted.symbol ?? '');
  const preserved = chartRef.current?.replaceHistory(accepted.candles, { timeframe, viewportMode }) ?? false;
  if (replaced && !preserved) {
    chartRef.current?.resetView();
  }
  afterReplace?.(dataKey);
  setChartError(receivedCandleCount > 0 && accepted.candles.length === 0 ? NONE_VALID_CANDLES_MESSAGE : undefined);
}
