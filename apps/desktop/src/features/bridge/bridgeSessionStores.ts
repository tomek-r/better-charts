import type {
  AccountSnapshot,
  BridgeStatus,
  BrokerSymbol,
  Candle,
  MarketSnapshot,
  PortfolioSnapshot,
  QuoteSnapshot,
} from '../../shared/bridge/types';
import { createDomainStore } from '../../shared/state/domainStore';

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
    connection: createDomainStore<BridgeConnectionStoreState>({
      status: { state: 'disconnected', message: 'Waiting for the local bridge to start.' },
      tauriAvailable: true,
    }),
    market: createDomainStore<BridgeMarketStoreState>({
      snapshot: emptySnapshot,
      latestCandle: undefined,
      instrument: undefined,
      lastSymbolSelection: undefined,
      loadingTimeframe: undefined,
      symbolLoading: false,
      chartError: undefined,
    }),
    quote: createDomainStore<BridgeQuoteStoreState>({ quote: undefined }),
    account: createDomainStore<BridgeAccountStoreState>({ account: undefined }),
    portfolio: createDomainStore<BridgePortfolioStoreState>({ portfolio: undefined }),
  };
}

export type BridgeSessionStores = ReturnType<typeof createBridgeSessionStores>;
