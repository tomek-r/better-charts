import type { OrderCheckError, OrderCheckResult, RiskPreview, RiskPreviewError } from '../../shared/bridge/types';
import type { OrderTicketState } from '../order-ticket/state/useOrderTicket';
import type { BridgeSessionState } from './useBridgeSession';

type PayloadEvent<T> = { payload: T };

export type BridgeTicketResponsePort = Pick<
  OrderTicketState,
  | 'riskVersion'
  | 'riskBrokerVersion'
  | 'riskPreviewDisplayRef'
  | 'setRiskPreview'
  | 'setRiskLoading'
  | 'setRiskError'
  | 'orderCheckGeneration'
  | 'orderCheckPending'
  | 'setOrderCheck'
  | 'setOrderCheckLoading'
  | 'setOrderCheckError'
>;

type BridgeTicketSession = Pick<BridgeSessionState, 'currentSymbol'>;

export function createBridgeTicketResponseHandlers(
  run: { disposed: boolean },
  session: BridgeTicketSession,
  ticket: BridgeTicketResponsePort,
  accountLoginRef: { current: string | undefined },
  brokerServerRef: { current: string | undefined },
) {
  const {
    riskVersion,
    setRiskPreview,
    riskPreviewDisplayRef,
    riskBrokerVersion,
    setRiskLoading,
    setRiskError,
    orderCheckGeneration,
    orderCheckPending,
    setOrderCheck,
    setOrderCheckLoading,
    setOrderCheckError,
  } = ticket;
  const { currentSymbol } = session;

  const onRiskPreview = (event: PayloadEvent<RiskPreview>) => {
    if (
      !run.disposed &&
      event.payload.draftVersion === riskVersion.current &&
      event.payload.symbol === currentSymbol.current
    ) {
      riskBrokerVersion.current = event.payload.draftVersion;
      setRiskPreview(event.payload);
      riskPreviewDisplayRef.current = event.payload;
      setRiskLoading(false);
      setRiskError(undefined);
    }
  };

  const onRiskPreviewError = (event: PayloadEvent<RiskPreviewError>) => {
    if (!run.disposed && event.payload.draftVersion === riskVersion.current) {
      setRiskLoading(false);
      setRiskError(event.payload.message);
    }
  };

  const onOrderCheckResult = (event: PayloadEvent<OrderCheckResult>) => {
    const pending = orderCheckPending.current;
    const result = event.payload;
    if (
      !run.disposed &&
      pending &&
      pending.generation === orderCheckGeneration.current &&
      pending.draftVersion === riskVersion.current &&
      result.draftVersion === pending.draftVersion &&
      result.symbol === pending.symbol &&
      result.accountLogin === pending.accountLogin &&
      result.brokerServer === pending.brokerServer &&
      result.symbol === currentSymbol.current &&
      result.accountLogin === accountLoginRef.current &&
      result.brokerServer === brokerServerRef.current
    ) {
      setOrderCheck(result);
      setOrderCheckLoading(false);
      setOrderCheckError(undefined);
      orderCheckPending.current = undefined;
    }
  };

  const onOrderCheckError = (event: PayloadEvent<OrderCheckError>) => {
    const pending = orderCheckPending.current;
    const error = event.payload;
    if (
      !run.disposed &&
      pending &&
      pending.generation === orderCheckGeneration.current &&
      pending.draftVersion === riskVersion.current &&
      error.draftVersion === pending.draftVersion
    ) {
      setOrderCheck(undefined);
      setOrderCheckLoading(false);
      setOrderCheckError(error.message);
      orderCheckPending.current = undefined;
    }
  };

  return { onRiskPreview, onRiskPreviewError, onOrderCheckResult, onOrderCheckError };
}
