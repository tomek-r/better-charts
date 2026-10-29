import type { OrderCheckError, OrderCheckResult, RiskPreview, RiskPreviewError } from '../../shared/bridge/types';
import type { OrderTicketCoordination, OrderTicketStores } from '../order-ticket/draft/orderTicketStores';
import type { AccountRefs, PayloadEvent } from './bridgeEventTypes';

export type BridgeTicketResponsePort = Pick<
  OrderTicketCoordination,
  'riskVersion' | 'riskBrokerVersion' | 'riskPreviewDisplayRef' | 'orderCheckGeneration' | 'orderCheckPending'
> &
  Pick<
    OrderTicketStores['setters']['broker'],
    | 'setRiskPreview'
    | 'setRiskLoading'
    | 'setRiskError'
    | 'setOrderCheck'
    | 'setOrderCheckLoading'
    | 'setOrderCheckError'
  >;

export function createBridgeTicketResponseHandlers(
  run: { disposed: boolean },
  currentSymbol: { current: string | undefined },
  ticket: BridgeTicketResponsePort,
  { accountLoginRef, brokerServerRef }: AccountRefs,
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

  /** The check still awaiting an answer, when this answer belongs to its generation and draft. */
  const pendingCheckFor = (draftVersion: number) => {
    const pending = orderCheckPending.current;
    if (
      pending &&
      pending.generation === orderCheckGeneration.current &&
      pending.draftVersion === riskVersion.current &&
      draftVersion === pending.draftVersion
    ) {
      return pending;
    }
    return undefined;
  };

  const settleOrderCheck = (outcome: { check: OrderCheckResult | undefined; error: string | undefined }) => {
    setOrderCheck(outcome.check);
    setOrderCheckLoading(false);
    setOrderCheckError(outcome.error);
    orderCheckPending.current = undefined;
  };

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
    const result = event.payload;
    const pending = pendingCheckFor(result.draftVersion);
    if (
      !run.disposed &&
      pending &&
      result.symbol === pending.symbol &&
      result.accountLogin === pending.accountLogin &&
      result.brokerServer === pending.brokerServer &&
      result.symbol === currentSymbol.current &&
      result.accountLogin === accountLoginRef.current &&
      result.brokerServer === brokerServerRef.current
    ) {
      settleOrderCheck({ check: result, error: undefined });
    }
  };

  const onOrderCheckError = (event: PayloadEvent<OrderCheckError>) => {
    const error = event.payload;
    if (!run.disposed && pendingCheckFor(error.draftVersion)) {
      settleOrderCheck({ check: undefined, error: error.message });
    }
  };

  return { onRiskPreview, onRiskPreviewError, onOrderCheckResult, onOrderCheckError };
}
