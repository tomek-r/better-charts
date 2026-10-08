import type {
  AccountSnapshot,
  BridgeStatus,
  BrokerSymbol,
  Candle,
  MarketSnapshot,
  QuoteSnapshot,
} from '../../../shared/bridge/types';
import type { ChartController } from '../../chart/engine/chartController';
import type { StagedOrderState } from '../../chart/engine/stagedOrderOverlay';

/** External bridge and chart inputs shared by the ticket's focused producer and runtime hooks. */
export type OrderTicketInputs = {
  chart: { current: ChartController | null };
  stagedOrderState: { current: StagedOrderState };
  instrumentDigitsRef: { current: number | undefined };
  stagedActiveRef: { current: boolean };
  instrument: BrokerSymbol | undefined;
  account: AccountSnapshot | undefined;
  quote: QuoteSnapshot | undefined;
  snapshot: MarketSnapshot;
  latestCandle: Candle | undefined;
  status: BridgeStatus;
};
