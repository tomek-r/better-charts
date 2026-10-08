import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  useBridgeAccountSelector,
  useBridgeConnectionSelector,
  useBridgeMarketSelector,
  useBridgeQuoteSelector,
} from '../../bridge/BridgeSessionProvider';
import { useOrderTicketStores } from '../state/orderTicketContext';
import { buildTicketDerivationInput } from '../domain/ticketDerivation';
import type { TicketDerivationBroker, TicketDerivationDraft } from '../domain/ticketDerivation';
import { deriveOrderTicket } from '../domain/ticketRules';
import type { BridgeStatus, BrokerSymbol, QuoteSnapshot } from '../../../shared/bridge/types';

export type TicketGateSources = {
  symbol: string | undefined;
  instrument: BrokerSymbol | undefined;
  bridgeState: BridgeStatus['state'];
  marketOpen: boolean | undefined;
  accountLogin: string | undefined;
  brokerServer: string | undefined;
  draft: TicketDerivationDraft;
  broker: TicketDerivationBroker;
  quote: QuoteSnapshot | undefined;
};

export function deriveTicketGateProjection(source: TicketGateSources) {
  const input = buildTicketDerivationInput(
    {
      symbol: source.symbol,
      bridgeState: source.bridgeState,
      account:
        source.accountLogin === undefined
          ? undefined
          : { accountLogin: source.accountLogin, brokerServer: source.brokerServer },
      instrument: source.instrument,
      quote: source.quote,
      marketOpen: source.marketOpen,
    },
    source.draft,
    source.broker,
  );
  return deriveOrderTicket(input);
}

export function useTicketGateProjection() {
  const stores = useOrderTicketStores();
  const { symbol, instrument } = useBridgeMarketSelector((market) => ({
    symbol: market.snapshot.symbol,
    instrument: market.instrument,
  }));
  const { bridgeState, marketOpen } = useBridgeConnectionSelector((connection) => ({
    bridgeState: connection.status.state,
    marketOpen: connection.status.marketSession?.isOpen,
  }));
  const { accountLogin, brokerServer } = useBridgeAccountSelector(
    useShallow((account) => ({ accountLogin: account?.accountLogin, brokerServer: account?.brokerServer })),
  );
  const draft = useStore(
    stores.draft,
    useShallow((state) => ({
      stagedOnChart: state.stagedOnChart,
      riskSide: state.riskSide,
      entry: state.entry,
      stopLoss: state.stopLoss,
      takeProfit: state.takeProfit,
      slOn: state.slOn,
      tpOn: state.tpOn,
      orderKind: state.orderKind,
      limitPrice: state.limitPrice,
      timeInForce: state.timeInForce,
      unitsMode: state.unitsMode,
      equityAllocationPercent: state.equityAllocationPercent,
      orderVolume: state.orderVolume,
      draftVersion: state.draftVersion,
    })),
  );
  const quote = useBridgeQuoteSelector((value) =>
    draft.stagedOnChart && draft.orderKind === 'market' ? value : undefined,
  );
  const { orderCheck, riskPreview, riskLoading } = useStore(
    stores.broker,
    useShallow((state) => ({
      orderCheck: state.orderCheck,
      riskPreview: state.riskPreview,
      riskLoading: state.riskLoading,
    })),
  );
  return deriveTicketGateProjection({
    symbol,
    instrument,
    bridgeState,
    marketOpen,
    accountLogin,
    brokerServer,
    draft,
    broker: { orderCheck, riskPreview, riskLoading },
    quote,
  });
}
