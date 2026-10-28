import { createContext, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { BrokerSymbol } from '../../shared/bridge/types';
import { useRequiredContext } from '../../shared/providers/useRequiredContext';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { createBridgeSessionStores, type BridgeSessionStores } from './bridgeSessionStores';
import { createMarketDataConnection } from './marketDataPort';
import { useBridgeSession, type BridgeSessionState } from './useBridgeSession';

export interface BridgeActions {
  requestHistory: (wire: string) => Promise<void>;
  chooseSymbol: (item: BrokerSymbol) => Promise<void>;
  /** Select a symbol by its NAME (portfolio rows carry no BrokerSymbol). */
  chooseSymbolByName: (symbol: string) => Promise<void>;
}

type BridgeRuntimeInjection = Pick<
  BridgeSessionState,
  | 'stores'
  | 'marketData'
  | 'loadingTimeframeRef'
  | 'pendingMetadata'
  | 'targetSymbol'
  | 'currentSymbol'
  | 'latestCandleRef'
  | 'dataKeyRef'
  | 'mounted'
  | 'requestGeneration'
  | 'currentTimeframe'
  | 'historyWaitSetters'
> & { actions: BridgeActions };
const RuntimeContext = createContext<BridgeRuntimeInjection | null>(null);

export function BridgeSessionProvider({ children }: { children: ReactNode }) {
  const resources = useChartResources();
  const [stores] = useState(createBridgeSessionStores);
  const [marketData] = useState(createMarketDataConnection);
  const session = useBridgeSession({
    stores,
    marketData,
    chart: resources.chart,
    adapterRef: resources.adapterRef,
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
      marketData,
      loadingTimeframeRef: session.loadingTimeframeRef,
      pendingMetadata: session.pendingMetadata,
      targetSymbol: session.targetSymbol,
      currentSymbol: session.currentSymbol,
      latestCandleRef: session.latestCandleRef,
      dataKeyRef: session.dataKeyRef,
      mounted: session.mounted,
      requestGeneration: session.requestGeneration,
      currentTimeframe: session.currentTimeframe,
      historyWaitSetters: session.historyWaitSetters,
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
      session.historyWaitSetters,
      stores,
      marketData,
    ],
  );

  return <RuntimeContext value={runtime}>{children}</RuntimeContext>;
}

function useRuntime(name: string): BridgeRuntimeInjection {
  return useRequiredContext(RuntimeContext, `${name} must be used inside BridgeSessionProvider.`);
}

/** The stores for a selector hook; `name` is the hook, so a misplaced call reports itself. */
export function useBridgeStoresOf(name: string): BridgeSessionStores {
  return useRuntime(name).stores;
}

/** Stable bridge domain stores for focused cross-domain selectors. */
export function useBridgeSessionStores(): BridgeSessionStores {
  return useBridgeStoresOf('useBridgeSessionStores');
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
  const quote = useStore(session.stores.quote, (state) => state.quote);
  return { ...session, quote };
}

export function useBridgeActions(): BridgeActions {
  return useRuntime('useBridgeActions').actions;
}
