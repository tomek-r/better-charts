import { useCallback, useEffect, useRef, useState } from 'react';
import { useEventCallback } from '../../shared/hooks/useEventCallback';
import { useBridgeAccount } from '../bridge/BridgeSessionProvider';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import type { PositionOverlayState } from '../chart/engine/positionOverlay';
import { useOrderTicketActions, useOrderTicketStores } from '../order-ticket/state/orderTicketContext';
import type { OrderTicketStores } from '../order-ticket/state/orderTicketStores';
import { AccountSwitchDialog } from './AccountSwitchDialog';
import { accountSwitchMessage, isAccountSwitch, type AccountIdentity } from './accountSwitch';

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
  // Late replies for the old account must find no matching pending request.
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
 * Detects an MT5 login/server change and drops everything bound to the old
 * account: staged and draft orders, sizing previews, OrderCheck/review state
 * and pending modifications. Chart symbol, timeframe, layout and drawing tools
 * stay. The previous identity is remembered across disconnects (the account
 * store clears on disconnect), so a reconnect to the same account is silent.
 */
export function AccountSwitchGuard() {
  const account = useBridgeAccount();
  const stores = useOrderTicketStores();
  const { clearStagedWidget, resetTicketToDefaults } = useOrderTicketActions();
  const { chart, positionOverlayState, setPendingModification } = useChartResources();
  const lastIdentity = useRef<AccountIdentity | undefined>(undefined);
  const [notice, setNotice] = useState<string>();
  const dismiss = useCallback(() => setNotice(undefined), []);

  const announceSwitch = useEventCallback(() => {
    if (!account) {
      return;
    }
    clearStagedWidget();
    resetTicketToDefaults();
    stores.draft.setters.setRiskSide('');
    stores.draft.setters.setStagedDragging(false);
    stores.draft.setters.setDragSlMoney(undefined);
    clearBrokerState(stores);
    setPendingModification(undefined);
    clearOverlayDrag(positionOverlayState);
    chart.current?.refreshOverlays();
    setNotice(accountSwitchMessage(account));
  });

  const login = account?.accountLogin;
  const server = account?.brokerServer;
  useEffect(() => {
    if (!login || !server) {
      return;
    }
    const next = { accountLogin: login, brokerServer: server };
    const switched = isAccountSwitch(lastIdentity.current, next);
    lastIdentity.current = next;
    if (switched) {
      announceSwitch();
    }
  }, [login, server, announceSwitch]);

  return notice ? <AccountSwitchDialog message={notice} onDismiss={dismiss} /> : null;
}
