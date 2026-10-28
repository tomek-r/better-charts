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
import { useBridgeStoresOf } from './BridgeSessionProvider';
import type { BridgeSessionStores } from './bridgeSessionStores';

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

export function useBridgeConnection(): BridgeConnection {
  const stores = useBridgeStoresOf('useBridgeConnection');
  return useStore(
    stores.connection,
    useShallow(({ status, tauriAvailable }) => ({ status, tauriAvailable })),
  );
}

export function useBridgeConnectionSelector<T>(selector: (connection: BridgeConnection) => T): T {
  const stores = useBridgeStoresOf('useBridgeConnectionSelector');
  return useStore(
    stores.connection,
    useShallow(({ status, tauriAvailable }) => selector({ status, tauriAvailable })),
  );
}

/** Read this separately when a consumer needs Tauri availability but not status updates. */
export function useTauriAvailable(): boolean {
  const stores = useBridgeStoresOf('useTauriAvailable');
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
  const stores = useBridgeStoresOf('useBridgeMarketSelector');
  return useStore(
    stores.market,
    useShallow((state) => selector(selectMarket(state))),
  );
}

export function useBridgeMarket(): BridgeMarket {
  return useBridgeMarketSelector((market) => market);
}

/** A history window or a live candle is a chart: either one gives the workspace something to draw. */
export function marketHasCandles(market: BridgeMarket): boolean {
  return market.snapshot.candles.length > 0 || market.latestCandle !== undefined;
}

/** As its own primitive subscription, so a candle tick that leaves the answer unchanged reaches no screen. */
export function useHasCandles(): boolean {
  return useBridgeMarketSelector(marketHasCandles);
}

export function useBridgeQuoteSelector<T>(selector: (quote: QuoteSnapshot | undefined) => T): T {
  const stores = useBridgeStoresOf('useBridgeQuoteSelector');
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
      hasCandles: marketHasCandles(market),
      chartError: market.chartError,
    };
  });
}

export function useBridgeAccountSelector<T>(selector: (account: AccountSnapshot | undefined) => T): T {
  const stores = useBridgeStoresOf('useBridgeAccountSelector');
  return useStore(stores.account, (state) => selector(state.account));
}

export function useBridgeAccount(): AccountSnapshot | undefined {
  return useBridgeAccountSelector((account) => account);
}

export function useBridgePortfolio(): PortfolioSnapshot | undefined {
  const stores = useBridgeStoresOf('useBridgePortfolio');
  return useStore(stores.portfolio, (state) => state.portfolio);
}

export function useLastSymbolSelection(): BrokerSymbol | undefined {
  const stores = useBridgeStoresOf('useLastSymbolSelection');
  return useStore(stores.market, (state) => state.lastSymbolSelection);
}
