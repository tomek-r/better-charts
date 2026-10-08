import type { ComponentProps } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  useBridgeAccountSelector,
  useBridgeConnectionSelector,
  useBridgeMarketSelector,
  useBridgeQuoteSelector,
} from '../../bridge/BridgeSessionProvider';
import { useOrderTicketActions, useOrderTicketStores } from '../state/orderTicketContext';
import type { OrderTicketReview } from '../review/OrderTicketReview';
import { deriveOrderTicket } from '../domain/ticketRules';
import { accountEnvironment } from '../domain/ticketFormatting';
import type { OrderTicketActionProps } from './orderTicketEditorTypes';

type HeaderEnvironment = ReturnType<typeof accountEnvironment>;
type HeaderState = { environment: HeaderEnvironment | undefined; symbol: string | undefined };
type ReviewProps = ComponentProps<typeof OrderTicketReview>;

export function useOrderTicketHeader(): HeaderState {
  const { symbol } = useBridgeMarketSelector((market) => ({ symbol: market.snapshot.symbol }));
  const accountPresent = useBridgeAccountSelector((account) => account !== undefined);
  const { tradeModeName, tradeMode, accountLogin, brokerServer } = useBridgeAccountSelector(
    useShallow((account) => ({
      tradeModeName: account?.accountTradeModeName,
      tradeMode: account?.accountTradeMode,
      accountLogin: account?.accountLogin,
      brokerServer: account?.brokerServer,
    })),
  );
  const environment = accountPresent
    ? accountEnvironment({
        accountLogin,
        brokerServer,
        accountTradeModeName: tradeModeName,
        accountTradeMode: tradeMode,
      })
    : undefined;
  return { environment, symbol };
}

export function useOrderTicketStage(): 'edit' | 'review' {
  const { draft } = useOrderTicketStores();
  return useStore(draft, (state) => state.ticketStage);
}

export function useOrderTicketReviewProps(): ReviewProps {
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const gate = useTicketGateProjection();
  const { currency, currencyDigits } = useBridgeAccountSelector(
    useShallow((account) => ({ currency: account?.currency, currencyDigits: account?.currencyDigits })),
  );
  const orderCheck = useStore(stores.broker, (state) => state.orderCheck);
  const orderCheckError = useStore(stores.broker, (state) => state.orderCheckError);
  const orderCheckLoading = useStore(stores.broker, (state) => state.orderCheckLoading);
  const submitStatus = useStore(stores.broker, (state) => state.submitStatus);
  const submittingSide = useStore(stores.broker, (state) => state.submittingSide);
  const { riskSide } = useStore(
    stores.draft,
    useShallow((state) => ({ riskSide: state.riskSide })),
  );
  return {
    account: currency === undefined ? undefined : { currency, currencyDigits },
    canSubmitOrder: gate.canSubmitOrder,
    effectiveVolume: gate.effectiveVolume,
    orderCheck,
    orderCheckError,
    orderCheckLoading,
    orderKindDisplay: gate.orderKindDisplay,
    ticketBlockedReason: gate.ticketBlockedReason,
    riskSide,
    setTicketStage: stores.setters.draft.setTicketStage,
    submitOrder: actions.submitOrder,
    submitStatus,
    submittingSide,
  };
}

function useTicketGateProjection() {
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
