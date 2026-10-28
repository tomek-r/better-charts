import { useEventCallback } from '../../../shared/identity/useEventCallback';
import { useChartResources } from '../../chart/ChartWorkspaceProvider';
import type { PositionOverlayState } from '../../chart/engine/trading/positionOverlayTypes';
import { useOrderTicketActions, useOrderTicketStores } from '../draft/orderTicketContext';
import type { OrderTicketStores } from '../draft/orderTicketStores';

/** Clears the sizing/OrderCheck stores and invalidates every in-flight reply. */
function clearBrokerState({ broker, coordination }: OrderTicketStores) {
  broker.setters.setRiskPreview(undefined);
  broker.setters.setRiskProjection(undefined);
  broker.setters.setRiskLoading(false);
  broker.setters.setRiskError(undefined);
  broker.setters.setOrderCheck(undefined);
  broker.setters.setOrderCheckLoading(false);
  broker.setters.setOrderCheckError(undefined);
  broker.setters.setSubmittingSide(undefined);
  broker.setters.setSubmitStatus(undefined);
  // Late replies for the old account or symbol must find no matching pending request.
  coordination.orderCheckGeneration.current += 1;
  coordination.orderCheckPending.current = undefined;
  coordination.pendingRiskRequestRef.current = undefined;
  coordination.riskBrokerVersion.current = undefined;
  coordination.riskPreviewDisplayRef.current = undefined;
  coordination.submitSwapPendingRef.current = false;
}

function clearOverlayDrag(overlay: { current: PositionOverlayState }) {
  overlay.current.drag = null;
}

/**
 * Drops everything bound to the previous account or symbol: staged and draft
 * orders, sizing previews, OrderCheck/review state and pending modifications.
 * Shared by the account-switch guard and the symbol-change reset so both clear
 * exactly the same state.
 */
export function useResetOrderTicket(): () => void {
  const stores = useOrderTicketStores();
  const { clearStagedWidget, resetTicketToDefaults } = useOrderTicketActions();
  const { chart, positionOverlayState, setPendingModification } = useChartResources();
  return useEventCallback(() => {
    clearStagedWidget();
    resetTicketToDefaults();
    stores.draft.setters.setStagedDragging(false);
    stores.draft.setters.setDragSlMoney(undefined);
    clearBrokerState(stores);
    setPendingModification(undefined);
    clearOverlayDrag(positionOverlayState);
    chart.current?.refreshOverlays();
  });
}
