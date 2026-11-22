// Bridge listeners are the sole source of accepted history and live candles.
// Selection refs reject stale events; the coordinator owns request dedupe and timeout.
import { useCallback, useMemo, useRef } from 'react';
import type { Candle, BrokerSymbol } from '../../shared/bridge/types';
import { initialHistoryBarsFor } from '../chart/engine/bars/initialHistoryWindow';
import { DEFAULT_TIMEFRAME } from '../../shared/bridge/timeframes';
import { isTickInterval } from '../../shared/bridge/chartIntervals';
import { useFieldSetterSelector } from '../../shared/store/fieldStore';
import type { BridgeSessionStores } from './bridgeSessionStores';
import type { BridgeMarketResources } from './market/bridgeMarketRuntime';
import type { ChartTickBars } from './market/chartTickBars';
import { beginHistoryWait, endHistoryWait } from './market/historyWait';
import type { MarketDataConnection } from './marketDataPort';

type BridgeSessionParams = BridgeMarketResources & {
  stores: BridgeSessionStores;
  marketData: MarketDataConnection;
};
export function useBridgeSession({ stores, marketData, chart, adapterRef }: BridgeSessionParams) {
  const pendingMetadata = useRef<BrokerSymbol | undefined>(undefined);
  const dataKeyRef = useRef('');
  const latestCandleRef = useRef<Candle | undefined>(undefined);
  const currentSymbol = useRef<string | undefined>(undefined);
  const currentTimeframe = useRef<string | undefined>(undefined);
  const requestGeneration = useRef(0);
  const loadingTimeframeRef = useRef<string | undefined>(undefined);
  const mounted = useRef(false);
  const targetSymbol = useRef<string | undefined>(undefined);
  /** The tick interval shown or owed; null while the chart draws MT5 bars. */
  const requestedTickIntervalRef = useRef<string | null>(null);
  /** The MT5 timeframe shown last: what a symbol switch requests while a tick interval is shown. */
  const mt5TimeframeRef = useRef<string>(DEFAULT_TIMEFRAME);
  /** The bridge run's tick bar source, installed while its listeners are alive. */
  const tickBarsRef = useRef<ChartTickBars | null>(null);
  const { setStatus, setTauriAvailable } = useFieldSetterSelector(stores.connection, (setters) => setters);
  const {
    setSnapshot,
    setLatestCandle,
    setInstrument,
    setLastSymbolSelection,
    setLoadingTimeframe,
    setSymbolLoading,
    setChartError,
    setHistoryWaitStartedAtMs,
    setHistoryUnavailable,
  } = useFieldSetterSelector(stores.market, (setters) => setters);
  const historyWaitSetters = useMemo(
    () => ({ setHistoryWaitStartedAtMs, setHistoryUnavailable }),
    [setHistoryWaitStartedAtMs, setHistoryUnavailable],
  );
  const { setQuote } = useFieldSetterSelector(stores.quote, (setters) => setters);
  const { setAccount } = useFieldSetterSelector(stores.account, (setters) => setters);
  const { setPortfolio } = useFieldSetterSelector(stores.portfolio, (setters) => setters);
  // Throws synchronously when there is no adapter, so each caller's catch runs
  // in the same turn it did before this was shared.
  const sendInitialHistory = useCallback(
    (symbol: string, timeframe: string): Promise<void> => {
      const adapter = adapterRef.current;
      if (!adapter) {
        throw new Error('chart adapter unavailable');
      }
      return adapter.requestHistory(symbol, timeframe, initialHistoryBarsFor(chart.current));
    },
    [adapterRef, chart],
  );
  const requestInterval = useCallback(
    async (wire: string) => {
      const symbol = targetSymbol.current ?? stores.market.getState().snapshot.symbol;
      if (!symbol || stores.connection.getState().status.state !== 'connected') {
        return;
      }
      if (isTickInterval(wire)) {
        // A tick interval has no series to request: its bars are read from the chart symbol's own ticks.
        requestedTickIntervalRef.current = wire;
        tickBarsRef.current?.show(symbol, wire);
        return;
      }
      // An MT5 timeframe draws candles: a tick read still in flight must not replace them.
      requestedTickIntervalRef.current = null;
      tickBarsRef.current?.stop();
      const generation = ++requestGeneration.current;
      loadingTimeframeRef.current = wire;
      setLoadingTimeframe(wire);
      beginHistoryWait(historyWaitSetters);
      try {
        await sendInitialHistory(symbol, wire);
      } catch {
        if (generation === requestGeneration.current) {
          loadingTimeframeRef.current = undefined;
          setLoadingTimeframe(undefined);
          endHistoryWait(historyWaitSetters);
          setChartError('History request could not be sent.');
        }
      }
    },
    [historyWaitSetters, sendInitialHistory, setChartError, setLoadingTimeframe, stores],
  );
  const requestSymbolSelection = useCallback(
    async (symbol: string, metadata?: BrokerSymbol) => {
      if (stores.connection.getState().status.state !== 'connected') {
        return;
      }
      pendingMetadata.current = metadata;
      targetSymbol.current = symbol;
      setInstrument(metadata);
      setQuote(undefined);
      setSymbolLoading(true);
      setChartError(undefined);
      beginHistoryWait(historyWaitSetters);
      const generation = ++requestGeneration.current;
      // A tick interval shows no MT5 series, so the window that moves the bridge to the
      // new symbol is requested on the last MT5 timeframe and its candles are dropped.
      const shown = loadingTimeframeRef.current ?? stores.market.getState().snapshot.timeframe;
      const timeframe = isTickInterval(shown) ? mt5TimeframeRef.current : (shown ?? DEFAULT_TIMEFRAME);
      try {
        await sendInitialHistory(symbol, timeframe);
      } catch {
        if (generation !== requestGeneration.current) {
          return;
        }
        pendingMetadata.current = undefined;
        targetSymbol.current = undefined;
        if (metadata) {
          setInstrument(undefined);
        }
        setSymbolLoading(false);
        endHistoryWait(historyWaitSetters);
        setChartError('History request could not be sent.');
      }
    },
    [historyWaitSetters, sendInitialHistory, setChartError, setInstrument, setQuote, setSymbolLoading, stores],
  );
  const chooseSymbol = useCallback(
    (item: BrokerSymbol) => requestSymbolSelection(item.symbol, item),
    [requestSymbolSelection],
  );
  // Position rows have only a symbol name; metadata arrives from the bridge
  // during its history request, so this path clears instrument state meanwhile.
  const chooseSymbolByName = useCallback(
    async (rawSymbol: string) => {
      const symbol = rawSymbol.trim();
      const snapshot = stores.market.getState().snapshot;
      if (stores.connection.getState().status.state !== 'connected' || !symbol) {
        return;
      }
      if (symbol === snapshot.symbol || symbol === targetSymbol.current) {
        return;
      }
      await requestSymbolSelection(symbol);
    },
    [requestSymbolSelection, stores],
  );
  return {
    stores,
    marketData,
    setStatus,
    setSnapshot,
    setLatestCandle,
    setQuote,
    setInstrument,
    setLastSymbolSelection,
    setAccount,
    setPortfolio,
    setSymbolLoading,
    setChartError,
    setHistoryWaitStartedAtMs,
    setHistoryUnavailable,
    historyWaitSetters,
    setTauriAvailable,
    setLoadingTimeframe,
    loadingTimeframeRef,
    pendingMetadata,
    targetSymbol,
    currentSymbol,
    latestCandleRef,
    dataKeyRef,
    mounted,
    requestGeneration,
    currentTimeframe,
    requestedTickIntervalRef,
    mt5TimeframeRef,
    tickBarsRef,
    requestInterval,
    chooseSymbol,
    chooseSymbolByName,
  };
}

type StoreState<Store extends { getState: () => unknown }> = ReturnType<Store['getState']>;

/**
 * Everything a bridge effect may read: the session's setters and refs (from
 * `useBridgeSession`) plus the store fields. The actions are exposed apart, as
 * `BridgeActions`. The provider supplies the store fields reactively, so the
 * hook itself never reads them at render.
 */
export type BridgeSessionState = Omit<
  ReturnType<typeof useBridgeSession>,
  'requestInterval' | 'chooseSymbol' | 'chooseSymbolByName'
> &
  StoreState<BridgeSessionStores['connection']> &
  StoreState<BridgeSessionStores['market']> &
  StoreState<BridgeSessionStores['quote']> &
  StoreState<BridgeSessionStores['account']> &
  StoreState<BridgeSessionStores['portfolio']>;
