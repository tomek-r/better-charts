import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  useBridgeAccountSelector,
  useBridgeConnectionSelector,
  useBridgeMarketSelector,
  useBridgeQuoteSelector,
} from '../../bridge/BridgeSessionProvider';
import { useOrderTicketActions, useOrderTicketStores } from '../state/orderTicketContext';
import { deriveOrderTicket } from '../domain/ticketRules';
import type { OrderTicketActionProps } from './orderTicketEditorTypes';

export function useOrderTicketStage(): 'edit' | 'review' {
  const { draft } = useOrderTicketStores();
  return useStore(draft, (state) => state.ticketStage);
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
  return deriveOrderTicket({
    symbol,
    bridgeState,
    account: accountLogin === undefined ? undefined : { accountLogin, brokerServer },
    stagedOnChart: draft.stagedOnChart,
    riskSide: draft.riskSide,
    entry: draft.entry,
    stopLoss: draft.stopLoss,
    takeProfit: draft.takeProfit,
    slOn: draft.slOn,
    tpOn: draft.tpOn,
    orderKind: draft.orderKind,
    limitPrice: draft.limitPrice,
    timeInForce: draft.timeInForce,
    unitsMode: draft.unitsMode,
    equityAllocationPercent: draft.equityAllocationPercent,
    orderVolume: draft.orderVolume,
    orderCheck,
    riskPreview,
    draftVersion: draft.draftVersion,
    riskLoading,
    instrument,
    quote,
    marketOpen,
  });
}

export function useOrderTicketAction(): OrderTicketActionProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const gate = useTicketGateProjection();
  const orderCheckLoading = useStore(stores.broker, (state) => state.orderCheckLoading);
  const side = useStore(stores.draft, (state) => state.riskSide);
  return {
    canCheckOrder: gate.canCheckOrder,
    orderCheckLoading,
    startOrderReview: actions.startOrderReview,
    side,
  };
}
