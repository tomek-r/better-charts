import { useEffect } from 'react';
import type { AccountRefs } from '../features/bridge/bridgeEventTypes';
import { useExecutionCommandEffects } from '../features/execution/useExecutionCommands';
import type { ExecutionCommandState } from '../features/execution/useExecutionCommands';
import { useBridgeBootstrapEffects } from '../features/bridge/useBridgeBootstrapEffects';
import { useBridgeStreamEffects } from '../features/bridge/useBridgeStreamEffects';
import { useLastChartSelectionEffects } from '../features/bridge/lastChartSelection/useLastChartSelectionEffects';
import { usePartialCloseAvailable } from '../features/partial-close/usePartialCloseAvailable';
import { useBridgeQuote } from '../features/bridge/bridgeSelectors';
import { useOrderTicketStores } from '../features/order-ticket/draft/orderTicketContext';
import type { BridgeSessionLifecycleState } from '../features/bridge/BridgeSessionProvider';
import {
  useChartWorkspaceInitEffects,
  useChartWorkspaceChartEffects,
  useChartWorkspaceResetEffects,
  useChartWorkspaceHotkeyEffect,
} from '../features/chart/workspace/useChartWorkspaceEffects';
import { useChartWorkspacePointerEffects } from '../features/chart/pointer/useChartWorkspacePointerEffects';
import {
  useChartWorkspaceMirrorRefEffect,
  useChartWorkspaceMirrorLayoutEffect,
} from '../features/chart/workspace/useChartOverlaySync';
import { useOrderTicketEntryEffects } from '../features/order-ticket/pricing/useOrderTicketEntryEffects';
import { useOrderTicketDefaultVolume } from '../features/order-ticket/sizing/useOrderTicketDefaultVolume';
import { useOrderTicketStopLossSnap } from '../features/order-ticket/stagedOrder/useOrderTicketStopLossSnap';
import { useOrderTicketOrderCheckEffects } from '../features/order-ticket/orderCheck/useOrderTicketOrderCheckEffects';
import { useOrderTicketRiskPreviewEffects } from '../features/order-ticket/riskPreview/useOrderTicketRiskPreviewEffects';
import { usePortfolioAccountResetEffect } from '../features/portfolio/usePortfolioAccountResetEffect';
import type { ChartWorkspaceState } from '../features/chart/workspace/useChartWorkspace';
import { useOrderTicketEntryRuntime } from '../features/order-ticket/pricing/useOrderTicketEntryRuntime';
import { useOrderTicketCheckRuntime } from '../features/order-ticket/orderCheck/useOrderTicketCheckRuntime';
import { useOrderTicketPreviewRuntime } from '../features/order-ticket/riskPreview/useOrderTicketPreviewRuntime';
import {
  useOrderTicketChartRuntime,
  type OrderTicketChartActions,
  type OrderTicketChartControls,
} from '../features/order-ticket/stagedOrder/useOrderTicketChartRuntime';
import type { BridgeTicketResponsePort } from '../features/bridge/bridgeTicketResponseHandlers';

export function LifecycleInitialization({
  workspace,
  session,
  execution,
}: {
  workspace: ChartWorkspaceState;
  session: BridgeSessionLifecycleState;
  execution: ExecutionCommandState;
}) {
  const { mounted: mountedRef, setChartError, currentSymbol, stores, marketData } = session;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, [mountedRef]);
  useExecutionCommandEffects(execution);
  useChartWorkspaceInitEffects(workspace, { setChartError, currentSymbol, stores, marketData });
  return null;
}

export function LifecyclePortfolioStream({
  session,
  workspace,
  ticket,
}: {
  session: BridgeSessionLifecycleState;
  workspace: ChartWorkspaceState;
  ticket: Pick<OrderTicketChartActions, 'clearStagedWidget'>;
}) {
  const quote = useBridgeQuote();
  const partialCloseAvailable = usePartialCloseAvailable();
  const submitSwapPendingRef = useOrderTicketStores().coordination.submitSwapPendingRef;
  useBridgeStreamEffects(
    { ...session, quote },
    {
      chart: workspace.chart,
      positionOverlayState: workspace.positionOverlayState,
      tradingSyncTick: workspace.tradingSyncTick,
      partialCloseAvailable,
      submitSwapPendingRef,
      clearStagedWidget: ticket.clearStagedWidget,
    },
  );
  return null;
}

export function LifecycleChartMarket({
  workspace,
  session,
  ticket,
}: {
  workspace: ChartWorkspaceState;
  session: BridgeSessionLifecycleState;
  ticket: Pick<OrderTicketChartActions, 'clearStagedWidget'>;
}) {
  const quote = useBridgeQuote();
  useChartWorkspaceChartEffects(workspace, { ...session, quote }, ticket);
  return null;
}

export function LifecycleAccountAndCheck({
  workspace,
  session,
  controls,
  accountRefs,
}: {
  workspace: ChartWorkspaceState;
  session: BridgeSessionLifecycleState;
  controls: OrderTicketChartControls;
  accountRefs: AccountRefs;
}) {
  const { accountLoginRef, brokerServerRef } = accountRefs;
  useEffect(() => {
    accountLoginRef.current = session.account?.accountLogin;
    brokerServerRef.current = session.account?.brokerServer;
  }, [accountLoginRef, brokerServerRef, session.account?.accountLogin, session.account?.brokerServer]);
  useLastChartSelectionEffects(session.snapshot, session.status, session.account);
  const check = useOrderTicketCheckRuntime(session);
  useOrderTicketOrderCheckEffects(check);
  useChartWorkspaceResetEffects(workspace, session, {
    setEntry: controls.setEntry,
    setStopLoss: controls.setStopLoss,
    setTakeProfit: controls.setTakeProfit,
  });
  usePortfolioAccountResetEffect(session);
  return null;
}

export function LifecycleTicketEntry() {
  const quote = useBridgeQuote();
  const entry = useOrderTicketEntryRuntime({ quote });
  useOrderTicketEntryEffects(entry);
  return null;
}

export function LifecycleBootstrapAndGestures({
  workspace,
  session,
  accountRefs,
  ticketActions,
  ticketControls,
  bridgeTicket,
}: {
  workspace: ChartWorkspaceState;
  session: BridgeSessionLifecycleState;
  accountRefs: AccountRefs;
  ticketActions: OrderTicketChartActions;
  ticketControls: OrderTicketChartControls;
  bridgeTicket: BridgeTicketResponsePort;
}) {
  const { chart, adapterRef } = workspace;
  const { accountLoginRef, brokerServerRef } = accountRefs;
  useBridgeBootstrapEffects(session, {
    chart,
    adapterRef,
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
  return null;
}

export function LifecycleTicketPreviewAndMirror({
  workspace,
  session,
  execution,
}: {
  workspace: ChartWorkspaceState;
  session: BridgeSessionLifecycleState;
  execution: ExecutionCommandState;
}) {
  const quote = useBridgeQuote();
  const ticketInputs = {
    instrument: session.instrument,
    account: session.account,
    quote,
    snapshot: session.snapshot,
    status: session.status,
  };
  const preview = useOrderTicketPreviewRuntime(ticketInputs);
  const ticketChart = useOrderTicketChartRuntime({
    instrument: session.instrument,
    account: session.account,
    snapshot: session.snapshot,
    quote,
  });
  useOrderTicketDefaultVolume(session.instrument);
  useOrderTicketStopLossSnap(ticketChart.slBand, session.instrument?.digits);
  useOrderTicketRiskPreviewEffects(preview.input, preview.riskBasis);
  useChartWorkspaceMirrorRefEffect(
    workspace,
    { instrument: session.instrument },
    { stagedOnChart: ticketChart.stagedOnChart },
    execution,
    execution.executionQueue?.dispatchEnabled === true,
  );
  useChartWorkspaceMirrorLayoutEffect(
    workspace,
    {
      instrument: session.instrument,
      snapshot: session.snapshot,
      latestCandle: session.latestCandle,
      quote,
    },
    ticketChart,
  );
  return null;
}
