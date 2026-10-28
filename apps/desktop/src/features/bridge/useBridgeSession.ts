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
        const adapter = adapterRef.current;
        if (!adapter) {
          throw new Error('chart adapter unavailable');
        }
        await adapter.requestHistory(symbol, wire, initialHistoryBarsFor(chart.current));
      } catch {
        if (generation === requestGeneration.current) {
          loadingTimeframeRef.current = undefined;
          setLoadingTimeframe(undefined);
          endHistoryWait(historyWaitSetters);
          setChartError('History request could not be sent.');
        }
      }
    },
    [adapterRef, chart, historyWaitSetters, setChartError, setLoadingTimeframe, stores],
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
        const adapter = adapterRef.current;
        if (!adapter) {
          throw new Error('chart adapter unavailable');
        }
        await adapter.requestHistory(
          symbol,
          loadingTimeframeRef.current ?? stores.market.getState().snapshot.timeframe ?? DEFAULT_TIMEFRAME,
          initialHistoryBarsFor(chart.current),
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
    [adapterRef, chart, historyWaitSetters, setChartError, setInstrument, setQuote, setSymbolLoading, stores],
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
    status: stores.connection.getState().status,
    setStatus,
    snapshot: stores.market.getState().snapshot,
    setSnapshot,
    latestCandle: stores.market.getState().latestCandle,
    setLatestCandle,
    quote: stores.quote.getState().quote,
    setQuote,
    instrument: stores.market.getState().instrument,
    setInstrument,
    lastSymbolSelection: stores.market.getState().lastSymbolSelection,
    setLastSymbolSelection,
    account: stores.account.getState().account,
    setAccount,
    portfolio: stores.portfolio.getState().portfolio,
    setPortfolio,
    symbolLoading: stores.market.getState().symbolLoading,
    setSymbolLoading,
    chartError: stores.market.getState().chartError,
    setChartError,
    setHistoryWaitStartedAtMs,
    setHistoryUnavailable,
    tauriAvailable: stores.connection.getState().tauriAvailable,
    setTauriAvailable,
    loadingTimeframe: stores.market.getState().loadingTimeframe,
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

export type BridgeSessionState = ReturnType<typeof useBridgeSession>;
