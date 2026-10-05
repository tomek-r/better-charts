import { createContext, useContext, useMemo, type Context, type ReactNode } from 'react';
import type {
  AccountSnapshot,
  BridgeStatus,
  BrokerSymbol,
  MarketSnapshot,
  PortfolioSnapshot,
  QuoteSnapshot,
} from '../../shared/bridge/types';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import { useBridgeSession, type BridgeSessionState } from './useBridgeSession';

export interface BridgeConnection {
  status: BridgeStatus;
  tauriAvailable: boolean;
}

export interface BridgeMarket {
  snapshot: MarketSnapshot;
  quote: QuoteSnapshot | undefined;
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

const RuntimeContext = createContext<BridgeSessionState | null>(null);
const ConnectionContext = createContext<BridgeConnection | null>(null);
const TauriAvailableContext = createContext<boolean | null>(null);
const MarketContext = createContext<BridgeMarket | null>(null);
const ChartStateContext = createContext<BridgeChartState | null>(null);
const AccountContext = createContext<AccountSnapshot | undefined | null>(null);
const PortfolioContext = createContext<PortfolioSnapshot | undefined | null>(null);
const ActionsContext = createContext<BridgeActions | null>(null);
const LastSymbolSelectionContext = createContext<BrokerSymbol | undefined | null>(null);

export function BridgeSessionProvider({ children }: { children: ReactNode }) {
  const resources = useChartResources();
  const session = useBridgeSession({
    chart: resources.chart,
    adapterRef: resources.adapterRef,
    fixedRangeProfileState: resources.fixedRangeProfileState,
    expectedProfile: resources.expectedProfile,
    profileGeneration: resources.profileGeneration,
    lastRequestedRangeRef: resources.lastRequestedRangeRef,
  });

  const connection = useMemo(
    () => ({ status: session.status, tauriAvailable: session.tauriAvailable }),
    [session.status, session.tauriAvailable],
  );
  const market = useMemo(
    () => ({
      snapshot: session.snapshot,
      quote: session.quote,
      instrument: session.instrument,
      symbolLoading: session.symbolLoading,
      chartError: session.chartError,
    }),
    [session.snapshot, session.quote, session.instrument, session.symbolLoading, session.chartError],
  );

  const symbol = session.snapshot.symbol;
  const timeframe = session.snapshot.timeframe;
  const description = session.instrument?.symbol === symbol ? session.instrument?.description : undefined;
  const hasCandles = session.snapshot.candles.length > 0;
  const chartState = useMemo<BridgeChartState>(
    () => ({
      symbol,
      timeframe,
      description,
      hasCandles,
      symbolLoading: session.symbolLoading,
      chartError: session.chartError,
    }),
    [symbol, timeframe, description, hasCandles, session.symbolLoading, session.chartError],
  );

  const actions = useMemo<BridgeActions>(
    () => ({
      requestHistory: session.requestHistory,
      chooseSymbol: session.chooseSymbol,
      chooseSymbolByName: session.chooseSymbolByName,
    }),
    [session.requestHistory, session.chooseSymbol, session.chooseSymbolByName],
  );

  return (
    <RuntimeContext.Provider value={session}>
      <ConnectionContext.Provider value={connection}>
        <TauriAvailableContext.Provider value={session.tauriAvailable}>
          <MarketContext.Provider value={market}>
            <ChartStateContext.Provider value={chartState}>
              <AccountContext.Provider value={session.account}>
                <PortfolioContext.Provider value={session.portfolio}>
                  <LastSymbolSelectionContext.Provider value={session.lastSymbolSelection}>
                    <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
                  </LastSymbolSelectionContext.Provider>
                </PortfolioContext.Provider>
              </AccountContext.Provider>
            </ChartStateContext.Provider>
          </MarketContext.Provider>
        </TauriAvailableContext.Provider>
      </ConnectionContext.Provider>
    </RuntimeContext.Provider>
  );
}

function useRequiredContext<T>(context: Context<T | null>, name: string): T {
  const value = useContext(context);
  if (value === null) {
    throw new Error(`${name} must be used inside BridgeSessionProvider.`);
  }
  return value;
}

/** Full bridge state for ordered lifecycle effects and domain integration only. */
export function useBridgeSessionRuntime(): BridgeSessionState {
  return useRequiredContext(RuntimeContext, 'useBridgeSessionRuntime');
}

export function useBridgeConnection(): BridgeConnection {
  return useRequiredContext(ConnectionContext, 'useBridgeConnection');
}

/** Read this separately when a consumer needs Tauri availability but not status updates. */
export function useTauriAvailable(): boolean {
  const value = useContext(TauriAvailableContext);
  if (value === null) {
    throw new Error('useTauriAvailable must be used inside BridgeSessionProvider.');
  }
  return value;
}

export function useBridgeMarket(): BridgeMarket {
  return useRequiredContext(MarketContext, 'useBridgeMarket');
}

export function useBridgeChartState(): BridgeChartState {
  return useRequiredContext(ChartStateContext, 'useBridgeChartState');
}

export function useBridgeAccount(): AccountSnapshot | undefined {
  const value = useContext(AccountContext);
  if (value === null) {
    throw new Error('useBridgeAccount must be used inside BridgeSessionProvider.');
  }
  return value;
}

export function useBridgePortfolio(): PortfolioSnapshot | undefined {
  const value = useContext(PortfolioContext);
  if (value === null) {
    throw new Error('useBridgePortfolio must be used inside BridgeSessionProvider.');
  }
  return value;
}

export function useBridgeActions(): BridgeActions {
  return useRequiredContext(ActionsContext, 'useBridgeActions');
}

export function useLastSymbolSelection(): BrokerSymbol | undefined {
  const value = useContext(LastSymbolSelectionContext);
  if (value === null) {
    throw new Error('useLastSymbolSelection must be used inside BridgeSessionProvider.');
  }
  return value;
}
