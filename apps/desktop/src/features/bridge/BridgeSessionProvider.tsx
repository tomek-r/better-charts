import { createContext, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type {
  AccountSnapshot,
  BridgeStatus,
  BrokerSymbol,
  Candle,
  MarketSnapshot,
  PortfolioSnapshot,
  QuoteSnapshot,
} from '../../shared/bridge/types';
import { useRequiredContext } from '../../shared/state/useRequiredContext';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { createBridgeSessionStores, type BridgeSessionStores } from './bridgeSessionStores';
import { useBridgeSession, type BridgeSessionState } from './useBridgeSession';

export interface BridgeConnection {
  status: BridgeStatus;
  tauriAvailable: boolean;
}

export interface BridgeMarket {
  /** Latest accepted history window; live frames are exposed through latestCandle. */
  snapshot: MarketSnapshot;
  /** Current accepted raw candle, including live bar updates. */
  latestCandle: Candle | undefined;
  instrument: BrokerSymbol | undefined;
  symbolLoading: boolean;
  chartError: string | undefined;
}

/** Chart UI state whose consumers do not need quote or candle updates. */
export interface BridgeChartState {
  symbol: string | undefined;
  timeframe: string | undefined;
  description: string | undefined;
  symbolLoading: boolean;
  hasCandles: boolean;
  chartError: string | undefined;
}

export interface BridgeActions {
  requestHistory: (wire: string) => Promise<void>;
  chooseSymbol: (item: BrokerSymbol) => Promise<void>;
  /** Select a symbol by its NAME (portfolio rows carry no BrokerSymbol). */
  chooseSymbolByName: (symbol: string) => Promise<void>;
}

type BridgeRuntimeInjection = Pick<
  BridgeSessionState,
  | 'stores'
  | 'loadingTimeframeRef'
  | 'pendingMetadata'
  | 'targetSymbol'
  | 'currentSymbol'
  | 'latestCandleRef'
  | 'dataKeyRef'
  | 'mounted'
  | 'requestGeneration'
  | 'currentTimeframe'
  | 'requestHistory'
  | 'chooseSymbol'
  | 'chooseSymbolByName'
  | 'requestProfileRange'
> & { actions: BridgeActions };
const RuntimeContext = createContext<BridgeRuntimeInjection | null>(null);

export function BridgeSessionProvider({ children }: { children: ReactNode }) {
  const resources = useChartResources();
  const [stores] = useState(createBridgeSessionStores);
  const session = useBridgeSession({
    stores,
    chart: resources.chart,
    adapterRef: resources.adapterRef,
    fixedRangeProfileState: resources.fixedRangeProfileState,
    expectedProfile: resources.expectedProfile,
    profileGeneration: resources.profileGeneration,
    lastRequestedRangeRef: resources.lastRequestedRangeRef,
  });
  const actions = useMemo<BridgeActions>(
    () => ({
      requestHistory: session.requestHistory,
      chooseSymbol: session.chooseSymbol,
      chooseSymbolByName: session.chooseSymbolByName,
    }),
    [session.requestHistory, session.chooseSymbol, session.chooseSymbolByName],
  );
  const runtime = useMemo<BridgeRuntimeInjection>(
    () => ({
      stores,
      loadingTimeframeRef: session.loadingTimeframeRef,
      pendingMetadata: session.pendingMetadata,
      targetSymbol: session.targetSymbol,
      currentSymbol: session.currentSymbol,
      latestCandleRef: session.latestCandleRef,
      dataKeyRef: session.dataKeyRef,
      mounted: session.mounted,
      requestGeneration: session.requestGeneration,
      currentTimeframe: session.currentTimeframe,
      requestHistory: session.requestHistory,
      chooseSymbol: session.chooseSymbol,
      chooseSymbolByName: session.chooseSymbolByName,
      requestProfileRange: session.requestProfileRange,
      actions,
    }),
    [
      actions,
      session.loadingTimeframeRef,
      session.pendingMetadata,
      session.targetSymbol,
      session.currentSymbol,
      session.latestCandleRef,
      session.dataKeyRef,
      session.mounted,
      session.requestGeneration,
      session.currentTimeframe,
      session.requestHistory,
      session.chooseSymbol,
      session.chooseSymbolByName,
      session.requestProfileRange,
      stores,
    ],
  );

  return <RuntimeContext value={runtime}>{children}</RuntimeContext>;
}

function useRuntime(name: string): BridgeRuntimeInjection {
  return useRequiredContext(RuntimeContext, `${name} must be used inside BridgeSessionProvider.`);
}

function useStores(name: string): BridgeSessionStores {
  return useRuntime(name).stores;
}

/** Stable bridge domain stores for focused cross-domain selectors. */
export function useBridgeSessionStores(): BridgeSessionStores {
  return useStores('useBridgeSessionStores');
}

/** Bridge lifecycle state without subscribing to quote changes. */
export type BridgeSessionLifecycleState = Omit<BridgeSessionState, 'quote'>;

export function useBridgeSessionLifecycleRuntime(): BridgeSessionLifecycleState {
  const runtime = useRuntime('useBridgeSessionLifecycleRuntime');
  const connection = useStore(runtime.stores.connection);
  const market = useStore(runtime.stores.market);
  const account = useStore(runtime.stores.account);
  const portfolio = useStore(runtime.stores.portfolio);
  return {
    ...runtime,
    ...connection,
    ...runtime.stores.connection.setters,
    ...market,
    ...runtime.stores.market.setters,
    ...runtime.stores.quote.setters,
    ...account,
    ...runtime.stores.account.setters,
    ...portfolio,
    ...runtime.stores.portfolio.setters,
  };
}

/** Full bridge state for ordered lifecycle effects and domain integration only. */
export function useBridgeSessionRuntime(): BridgeSessionState {
  const session = useBridgeSessionLifecycleRuntime();
  const quote = useBridgeQuote();
  return { ...session, quote };
}

export function useBridgeConnection(): BridgeConnection {
  const stores = useStores('useBridgeConnection');
  return useStore(
    stores.connection,
    useShallow(({ status, tauriAvailable }) => ({ status, tauriAvailable })),
  );
}

export function useBridgeConnectionSelector<T>(selector: (connection: BridgeConnection) => T): T {
  const stores = useStores('useBridgeConnectionSelector');
  return useStore(
    stores.connection,
    useShallow(({ status, tauriAvailable }) => selector({ status, tauriAvailable })),
  );
}

/** Read this separately when a consumer needs Tauri availability but not status updates. */
export function useTauriAvailable(): boolean {
  const stores = useStores('useTauriAvailable');
  return useStore(stores.connection, (state) => state.tauriAvailable);
}

function selectMarket(state: ReturnType<BridgeSessionStores['market']['getState']>): BridgeMarket {
  return {
    snapshot: state.snapshot,
    latestCandle: state.latestCandle,
    instrument: state.instrument,
    symbolLoading: state.symbolLoading,
    chartError: state.chartError,
  };
}

export function useBridgeMarketSelector<T>(selector: (market: BridgeMarket) => T): T {
  const stores = useStores('useBridgeMarketSelector');
  return useStore(
    stores.market,
    useShallow((state) => selector(selectMarket(state))),
  );
}

export function useBridgeMarket(): BridgeMarket {
  return useBridgeMarketSelector((market) => market);
}

export function useBridgeQuoteSelector<T>(selector: (quote: QuoteSnapshot | undefined) => T): T {
  const stores = useStores('useBridgeQuoteSelector');
  return useStore(stores.quote, (state) => selector(state.quote));
}

export function useBridgeQuote(): QuoteSnapshot | undefined {
  return useBridgeQuoteSelector((quote) => quote);
}

export function useBridgeChartState(): BridgeChartState {
  return useBridgeMarketSelector((market) => {
    const symbol = market.snapshot.symbol;
    return {
      symbol,
      timeframe: market.snapshot.timeframe,
      description: market.instrument?.symbol === symbol ? market.instrument?.description : undefined,
      symbolLoading: market.symbolLoading,
      hasCandles: market.snapshot.candles.length > 0 || market.latestCandle !== undefined,
      chartError: market.chartError,
    };
  });
}

export function useBridgeAccountSelector<T>(selector: (account: AccountSnapshot | undefined) => T): T {
  const stores = useStores('useBridgeAccountSelector');
  return useStore(stores.account, (state) => selector(state.account));
}

export function useBridgeAccount(): AccountSnapshot | undefined {
  return useBridgeAccountSelector((account) => account);
}

export function useBridgePortfolio(): PortfolioSnapshot | undefined {
  const stores = useStores('useBridgePortfolio');
  return useStore(stores.portfolio, (state) => state.portfolio);
}

export function useBridgeActions(): BridgeActions {
  return useRuntime('useBridgeActions').actions;
}

export function useLastSymbolSelection(): BrokerSymbol | undefined {
  const stores = useStores('useLastSymbolSelection');
  return useStore(stores.market, (state) => state.lastSymbolSelection);
}
