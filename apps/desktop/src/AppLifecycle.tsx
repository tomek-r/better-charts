import { useEffect, useRef } from 'react';
import { useExecutionCommandEffects } from './features/execution/useExecutionCommands';
import { useBridgeBootstrapEffects } from './features/bridge/effects/useBridgeBootstrapEffects';
import { useBridgeStreamEffects } from './features/bridge/effects/useBridgeStreamEffects';
import {
  useChartWorkspaceInitEffects,
  useChartWorkspaceChartEffects,
  useChartWorkspaceResetEffects,
  useChartWorkspaceHotkeyEffect,
} from './features/chart/effects/useChartLifecycle';
import { useChartWorkspacePointerEffects } from './features/chart/effects/useChartGestures';
import {
  useChartWorkspaceMirrorRefEffect,
  useChartWorkspaceMirrorLayoutEffect,
} from './features/chart/effects/useChartOverlaySync';
import { useOrderTicketEntryEffects } from './features/order-ticket/effects/useOrderTicketEntryEffects';
import { useOrderTicketOrderCheckEffects } from './features/order-ticket/effects/useOrderTicketOrderCheckEffects';
import { useOrderTicketRiskPreviewEffects } from './features/order-ticket/effects/useOrderTicketRiskPreviewEffects';
import { usePortfolioAccountResetEffect } from './features/portfolio/usePortfolio';
import { useBridgeSessionRuntime } from './features/bridge/BridgeSessionProvider';
import { useChartWorkspaceRuntime } from './features/chart/ChartWorkspaceProvider';
import { useExecutionRuntime } from './features/execution/ExecutionProvider';
import { useOrderRiskBasis } from './features/order-ticket/editor/orderTicketSizingViews';
import { useOrderTicketRuntime } from './features/order-ticket/state/useOrderTicketRuntime';

/**
 * Registers the cross-domain effect slots in their frozen registration order.
 * Renders nothing: it exists for its tree position — inside the ticket provider
 * and after the chart host, so the host ref attaches before init layout
 * effects run. These integrations use private runtime interfaces; views consume
 * focused contexts.
 */
export function AppLifecycle() {
  const workspace = useChartWorkspaceRuntime();
  const session = useBridgeSessionRuntime();
  const ticket = useOrderTicketRuntime();
  const execution = useExecutionRuntime();
  const riskBasis = useOrderRiskBasis();
  const { chart, adapterRef, fixedRangeProfileState, expectedProfile, profileGeneration } = workspace;
  const { mounted: mountedRef, account } = session;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, [mountedRef]);
  useExecutionCommandEffects(execution);
  useChartWorkspaceInitEffects(workspace, session);
  useBridgeStreamEffects(session, {
    chart,
    positionOverlayState: workspace.positionOverlayState,
    tradingSyncTick: workspace.tradingSyncTick,
    submitSwapPendingRef: ticket.submitSwapPendingRef,
    clearStagedWidget: ticket.clearStagedWidget,
  });
  useChartWorkspaceChartEffects(workspace, session, ticket);

  const accountLoginRef = useRef<string | undefined>(undefined);
  const brokerServerRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    accountLoginRef.current = account?.accountLogin;
    brokerServerRef.current = account?.brokerServer;
  }, [account?.accountLogin, account?.brokerServer]);

  useOrderTicketOrderCheckEffects(ticket);
  useChartWorkspaceResetEffects(workspace, session, ticket);
  usePortfolioAccountResetEffect(session);
  useOrderTicketEntryEffects(ticket);
  useBridgeBootstrapEffects(session, {
    chart,
    adapterRef,
    fixedRangeProfileState,
    expectedProfile,
    profileGeneration,
    accountLoginRef,
    brokerServerRef,
    ticket,
  });
  useChartWorkspaceHotkeyEffect(workspace, ticket);
  useChartWorkspacePointerEffects(workspace, ticket);
  useOrderTicketRiskPreviewEffects(ticket, riskBasis);
  useChartWorkspaceMirrorRefEffect(
    workspace,
    session,
    ticket,
    {
      requestModifyDraft: execution.requestModifyDraft,
      requestClosePosition: execution.requestClosePosition,
      requestCancelOrder: execution.requestCancelOrder,
    },
    execution.executionQueue?.dispatchEnabled === true,
  );
  useChartWorkspaceMirrorLayoutEffect(workspace, session, ticket);
  return null;
}
