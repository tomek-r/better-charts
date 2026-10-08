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
import type { OrderTicketInputs } from './features/order-ticket/state/orderTicketInputs';
import { useOrderTicketEntryRuntime } from './features/order-ticket/state/useOrderTicketEntryRuntime';
import { useOrderTicketCheckRuntime } from './features/order-ticket/state/useOrderTicketCheckRuntime';
import { useOrderTicketPreviewRuntime } from './features/order-ticket/state/useOrderTicketPreviewRuntime';
import {
  useOrderTicketChartActions,
  useOrderTicketChartControls,
  useOrderTicketChartRuntime,
} from './features/order-ticket/state/useOrderTicketChartRuntime';
import { useOrderTicketBridgeResponsePort } from './features/order-ticket/state/useOrderTicketBridgeResponsePort';

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
  const ticketInputs: Pick<OrderTicketInputs, 'instrument' | 'account' | 'quote' | 'snapshot' | 'status'> = {
    instrument: session.instrument,
    account: session.account,
    quote: session.quote,
    snapshot: session.snapshot,
    status: session.status,
  };
  const ticketEntry = useOrderTicketEntryRuntime(ticketInputs);
  const ticketCheck = useOrderTicketCheckRuntime(ticketInputs);
  const ticketPreview = useOrderTicketPreviewRuntime(ticketInputs);
  const ticketChart = useOrderTicketChartRuntime(ticketInputs);
  const ticketActions = useOrderTicketChartActions();
  const ticketControls = useOrderTicketChartControls();
  const bridgeTicket = useOrderTicketBridgeResponsePort();
  const execution = useExecutionRuntime();
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
    submitSwapPendingRef: ticketChart.submitSwapPendingRef,
    clearStagedWidget: ticketActions.clearStagedWidget,
  });
  useChartWorkspaceChartEffects(workspace, session, { clearStagedWidget: ticketActions.clearStagedWidget });

  const accountLoginRef = useRef<string | undefined>(undefined);
  const brokerServerRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    accountLoginRef.current = account?.accountLogin;
    brokerServerRef.current = account?.brokerServer;
  }, [account?.accountLogin, account?.brokerServer]);

  useOrderTicketOrderCheckEffects(ticketCheck);
  useChartWorkspaceResetEffects(workspace, session, {
    setEntry: ticketControls.setEntry,
    setStopLoss: ticketControls.setStopLoss,
    setTakeProfit: ticketControls.setTakeProfit,
  });
  usePortfolioAccountResetEffect(session);
  useOrderTicketEntryEffects(ticketEntry);
  useBridgeBootstrapEffects(session, {
    chart,
    adapterRef,
    fixedRangeProfileState,
    expectedProfile,
    profileGeneration,
    accountLoginRef,
    brokerServerRef,
    ticket: bridgeTicket,
  });
  useChartWorkspaceHotkeyEffect(workspace, { unstageOrderDraft: ticketActions.unstageOrderDraft });
  useChartWorkspacePointerEffects(workspace, {
    unstageOrderDraft: ticketActions.unstageOrderDraft,
    toggleExit: ticketActions.toggleExit,
    ...ticketControls,
  });
  useOrderTicketRiskPreviewEffects(ticketPreview.input, ticketPreview.riskBasis);
  useChartWorkspaceMirrorRefEffect(
    workspace,
    session,
    { stagedOnChart: ticketChart.stagedOnChart },
    {
      requestModifyDraft: execution.requestModifyDraft,
      requestClosePosition: execution.requestClosePosition,
      requestCancelOrder: execution.requestCancelOrder,
    },
    execution.executionQueue?.dispatchEnabled === true,
  );
  useChartWorkspaceMirrorLayoutEffect(workspace, session, ticketChart);
  return null;
}
