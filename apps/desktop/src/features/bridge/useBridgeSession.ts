// Bridge listeners are the sole source of accepted history and live candles.
// Selection refs reject stale events; the coordinator owns request dedupe and timeout.
import { useCallback, useMemo, useRef } from 'react';
import type { Candle, BrokerSymbol } from '../../shared/bridge/types';
import { initialHistoryBarsFor } from '../chart/engine/bars/initialHistoryWindow';
import { DEFAULT_TIMEFRAME } from '../../shared/bridge/timeframes';
import { useFieldSetterSelector } from '../../shared/providers/domainStore';
import type { BridgeSessionStores } from './bridgeSessionStores';
import type { BridgeMarketResources } from './market/bridgeMarketRuntime';
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
  const requestHistory = useCallback(
    async (wire: string) => {
      const symbol = targetSymbol.current ?? stores.market.getState().snapshot.symbol;
      if (!symbol || stores.connection.getState().status.state !== 'connected') {
        return;
      }
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
      try {
        await sendInitialHistory(
          symbol,
          loadingTimeframeRef.current ?? stores.market.getState().snapshot.timeframe ?? DEFAULT_TIMEFRAME,
        );
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
    requestHistory,
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
  'requestHistory' | 'chooseSymbol' | 'chooseSymbolByName'
> &
  StoreState<BridgeSessionStores['connection']> &
  StoreState<BridgeSessionStores['market']> &
  StoreState<BridgeSessionStores['quote']> &
  StoreState<BridgeSessionStores['account']> &
  StoreState<BridgeSessionStores['portfolio']>;
