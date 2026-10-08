// Bridge listeners are the sole source of accepted history and live candles.
// Selection refs reject stale events; the coordinator owns request dedupe and timeout.
import { useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { ChartController } from '../chart/engine/chartController';
import type { Mt5DataAdapter } from '../chart/engine/mt5DataAdapter';
import type { FixedRangeProfileState } from '../chart/engine/fixedRangeProfileOverlay';
import type { Candle, BrokerSymbol } from '../../shared/bridge/types';
import { HISTORY_BARS } from '../../shared/bridge/limits';
import { DEFAULT_TIMEFRAME } from '../../shared/bridge/timeframes';
import { useFieldSetterSelector } from '../../shared/state/domainStore';
import type { BridgeSessionStores } from './bridgeSessionStores';

type BridgeSessionParams = {
  stores: BridgeSessionStores;
  chart: { current: ChartController | null };
  adapterRef: { current: Mt5DataAdapter | null };
  fixedRangeProfileState: { current: FixedRangeProfileState };
  expectedProfile: { current: { symbol: string; fromMs: number; endMs: number; generation: number } | undefined };
  profileGeneration: { current: number };
  lastRequestedRangeRef: { current: { fromMs: number; endMs: number } | undefined };
};
export function useBridgeSession({
  stores,
  chart,
  adapterRef,
  fixedRangeProfileState,
  expectedProfile,
  profileGeneration,
  lastRequestedRangeRef,
}: BridgeSessionParams) {
  const profileGenerationRef = profileGeneration;
  const expectedProfileRef = expectedProfile;
  const fixedRangeProfileRef = fixedRangeProfileState;
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
  } = useFieldSetterSelector(stores.market, (setters) => setters);
  const { setQuote } = useFieldSetterSelector(stores.quote, (setters) => setters);
  const { setAccount } = useFieldSetterSelector(stores.account, (setters) => setters);
  const { setPortfolio } = useFieldSetterSelector(stores.portfolio, (setters) => setters);
  const requestProfileRange = useCallback(
    (range = chart.current?.getProfileRange() ?? undefined) => {
      const symbol = currentSymbol.current;
      if (!symbol || !range) {
        return;
      }
      const { fromMs, endMs } = range;
      lastRequestedRangeRef.current = { fromMs, endMs };
      const generation = ++profileGenerationRef.current;
      expectedProfileRef.current = { symbol, fromMs, endMs, generation };
      fixedRangeProfileRef.current.range = { fromMs, toMs: endMs };
      fixedRangeProfileState.current.profile = undefined;
      chart.current?.refreshOverlays();
      void invoke('request_tick_profile', { symbol, fromMs, endMs, rows: 128 }).catch(() => undefined);
    },
    [
      chart,
      expectedProfileRef,
      fixedRangeProfileRef,
      fixedRangeProfileState,
      lastRequestedRangeRef,
      profileGenerationRef,
    ],
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
      try {
        const adapter = adapterRef.current;
        if (!adapter) {
          throw new Error('chart adapter unavailable');
        }
        await adapter.requestHistory(symbol, wire, HISTORY_BARS);
      } catch {
        if (generation === requestGeneration.current) {
          loadingTimeframeRef.current = undefined;
          setLoadingTimeframe(undefined);
          setChartError('History request could not be sent.');
        }
      }
    },
    [adapterRef, setChartError, setLoadingTimeframe, stores],
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
      const generation = ++requestGeneration.current;
      try {
        const adapter = adapterRef.current;
        if (!adapter) {
          throw new Error('chart adapter unavailable');
        }
        await adapter.requestHistory(
          symbol,
          loadingTimeframeRef.current ?? stores.market.getState().snapshot.timeframe ?? DEFAULT_TIMEFRAME,
          HISTORY_BARS,
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
        setChartError('History request could not be sent.');
      }
    },
    [adapterRef, setChartError, setInstrument, setQuote, setSymbolLoading, stores],
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
    requestProfileRange,
  };
}

export type BridgeSessionState = ReturnType<typeof useBridgeSession>;
