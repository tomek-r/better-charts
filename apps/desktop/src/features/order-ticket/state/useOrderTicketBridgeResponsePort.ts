import type { BridgeTicketResponsePort } from '../../bridge/bridgeTicketResponseHandlers';
import { useOrderTicketStores } from './orderTicketContext';

export function useOrderTicketBridgeResponsePort(): BridgeTicketResponsePort {
  const stores = useOrderTicketStores();
  return {
    riskVersion: stores.coordination.riskVersion,
    riskBrokerVersion: stores.coordination.riskBrokerVersion,
    riskPreviewDisplayRef: stores.coordination.riskPreviewDisplayRef,
    orderCheckGeneration: stores.coordination.orderCheckGeneration,
    orderCheckPending: stores.coordination.orderCheckPending,
    setRiskPreview: stores.setters.broker.setRiskPreview,
    setRiskLoading: stores.setters.broker.setRiskLoading,
    setRiskError: stores.setters.broker.setRiskError,
    setOrderCheck: stores.setters.broker.setOrderCheck,
    setOrderCheckLoading: stores.setters.broker.setOrderCheckLoading,
    setOrderCheckError: stores.setters.broker.setOrderCheckError,
  };
}
