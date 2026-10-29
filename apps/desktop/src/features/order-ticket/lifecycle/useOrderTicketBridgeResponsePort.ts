import { useMemo } from 'react';
import type { BridgeTicketResponsePort } from '../../bridge/bridgeTicketResponseHandlers';
import { useOrderTicketStores } from '../draft/orderTicketContext';

/** Stable for the life of the ticket stores, so a bridge effect can depend on the port itself. */
export function useOrderTicketBridgeResponsePort(): BridgeTicketResponsePort {
  const stores = useOrderTicketStores();
  return useMemo(
    () => ({
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
    }),
    [stores],
  );
}
