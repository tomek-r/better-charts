import type {
  AccountSnapshot,
  BridgeStatus,
  BrokerSymbol,
  Candle,
  HistoryUnavailable,
  MarketSnapshot,
  PortfolioSnapshot,
  QuoteSnapshot,
} from '../../shared/bridge/types';
import { createFieldStore } from '../../shared/store/fieldStore';

interface BridgeConnectionStoreState {
  status: BridgeStatus;
  tauriAvailable: boolean;
}

interface BridgeMarketStoreState {
  snapshot: MarketSnapshot;
  latestCandle: Candle | undefined;
  instrument: BrokerSymbol | undefined;
  lastSymbolSelection: BrokerSymbol | undefined;
  loadingTimeframe: string | undefined;
  symbolLoading: boolean;
  chartError: string | undefined;
  /** When the pending initial history request of the current selection started; drives the wait notice. */
  historyWaitStartedAtMs: number | undefined;
  /** The selection whose series the EA could not synchronize in time. */
  historyUnavailable: HistoryUnavailable | undefined;
}

interface BridgeQuoteStoreState {
  quote: QuoteSnapshot | undefined;
}

interface BridgeAccountStoreState {
  account: AccountSnapshot | undefined;
}

interface BridgePortfolioStoreState {
  portfolio: PortfolioSnapshot | undefined;
}

const emptySnapshot: MarketSnapshot = { complete: false, candles: [] };

export function createBridgeSessionStores() {
  return {
    connection: createFieldStore<BridgeConnectionStoreState>({
      status: { state: 'disconnected', message: 'Waiting for the local bridge to start.' },
      tauriAvailable: true,
    }),
    market: createFieldStore<BridgeMarketStoreState>({
      snapshot: emptySnapshot,
      latestCandle: undefined,
      instrument: undefined,
      lastSymbolSelection: undefined,
      loadingTimeframe: undefined,
      symbolLoading: false,
      chartError: undefined,
      historyWaitStartedAtMs: undefined,
      historyUnavailable: undefined,
    }),
    quote: createFieldStore<BridgeQuoteStoreState>({ quote: undefined }),
    account: createFieldStore<BridgeAccountStoreState>({ account: undefined }),
    portfolio: createFieldStore<BridgePortfolioStoreState>({ portfolio: undefined }),
  };
}

export type BridgeSessionStores = ReturnType<typeof createBridgeSessionStores>;
