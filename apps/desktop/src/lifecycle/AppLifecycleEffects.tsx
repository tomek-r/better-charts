import { useEffect, type RefObject } from 'react';
import { useExecutionCommandEffects } from '../features/execution/useExecutionCommands';
import type { ExecutionCommandState } from '../features/execution/useExecutionCommands';
import { useBridgeBootstrapEffects } from '../features/bridge/effects/useBridgeBootstrapEffects';
import { useBridgeStreamEffects } from '../features/bridge/effects/useBridgeStreamEffects';
import { useBridgeQuote } from '../features/bridge/BridgeSessionProvider';
import { useOrderTicketStores } from '../features/order-ticket/state/orderTicketContext';
import type { BridgeSessionLifecycleState } from '../features/bridge/BridgeSessionProvider';
import {
  useChartWorkspaceInitEffects,
  useChartWorkspaceChartEffects,
  useChartWorkspaceResetEffects,
  useChartWorkspaceHotkeyEffect,
} from '../features/chart/effects/useChartLifecycle';
import { useChartWorkspacePointerEffects } from '../features/chart/effects/useChartGestures';
import {
  useChartWorkspaceMirrorRefEffect,
  useChartWorkspaceMirrorLayoutEffect,
} from '../features/chart/effects/useChartOverlaySync';
import { useOrderTicketEntryEffects } from '../features/order-ticket/effects/useOrderTicketEntryEffects';
import { useOrderTicketOrderCheckEffects } from '../features/order-ticket/effects/useOrderTicketOrderCheckEffects';
import { useOrderTicketRiskPreviewEffects } from '../features/order-ticket/effects/useOrderTicketRiskPreviewEffects';
import { usePortfolioAccountResetEffect } from '../features/portfolio/usePortfolio';
import type { ChartWorkspaceState } from '../features/chart/state/useChartWorkspace';
import { useOrderTicketEntryRuntime } from '../features/order-ticket/state/useOrderTicketEntryRuntime';
import { useOrderTicketCheckRuntime } from '../features/order-ticket/state/useOrderTicketCheckRuntime';
import { useOrderTicketPreviewRuntime } from '../features/order-ticket/state/useOrderTicketPreviewRuntime';
import {
  useOrderTicketChartActions,
  useOrderTicketChartControls,
  useOrderTicketChartRuntime,
} from '../features/order-ticket/state/useOrderTicketChartRuntime';
import type { BridgeTicketResponsePort } from '../features/bridge/bridgeTicketResponseHandlers';

type InitializationSession = Pick<BridgeSessionLifecycleState, 'mounted' | 'setChartError' | 'requestProfileRange'>;
type StreamSession = Pick<BridgeSessionLifecycleState, 'snapshot' | 'instrument' | 'account' | 'portfolio'>;
type ChartSession = Pick<
  BridgeSessionLifecycleState,
  | 'instrument'
  | 'loadingTimeframe'
  | 'snapshot'
  | 'setLoadingTimeframe'
  | 'setChartError'
  | 'currentSymbol'
  | 'setQuote'
  | 'setInstrument'
  | 'targetSymbol'
  | 'status'
>;
type AccountSession = Pick<
  BridgeSessionLifecycleState,
  | 'account'
  | 'status'
  | 'snapshot'
  | 'loadingTimeframeRef'
  | 'targetSymbol'
  | 'pendingMetadata'
  | 'setLoadingTimeframe'
  | 'setQuote'
  | 'setInstrument'
  | 'setAccount'
  | 'setPortfolio'
  | 'setSymbolLoading'
>;
type BootstrapSession = Pick<
  BridgeSessionLifecycleState,
  | 'stores'
  | 'loadingTimeframeRef'
  | 'targetSymbol'
  | 'pendingMetadata'
  | 'currentSymbol'
  | 'currentTimeframe'
  | 'latestCandleRef'
  | 'dataKeyRef'
>;
type PreviewSession = Pick<
  BridgeSessionLifecycleState,
  'instrument' | 'account' | 'snapshot' | 'latestCandle' | 'status'
>;
type TicketControls = ReturnType<typeof useOrderTicketChartControls>;
type TicketActions = ReturnType<typeof useOrderTicketChartActions>;
type AccountRefs = {
  accountLoginRef: RefObject<string | undefined>;
  brokerServerRef: RefObject<string | undefined>;
};

export function LifecycleInitialization({
  workspace,
  session,
  execution,
}: {
  workspace: ChartWorkspaceState;
  session: InitializationSession;
  execution: ExecutionCommandState;
}) {
  const { mounted: mountedRef, setChartError, requestProfileRange } = session;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, [mountedRef]);
  useExecutionCommandEffects(execution);
  useChartWorkspaceInitEffects(workspace, { setChartError, requestProfileRange });
  return null;
}

export function LifecyclePortfolioStream({
  session,
  workspace,
  ticket,
}: {
  session: StreamSession;
  workspace: ChartWorkspaceState;
  ticket: Pick<TicketActions, 'clearStagedWidget'>;
}) {
  const quote = useBridgeQuote();
  const submitSwapPendingRef = useOrderTicketStores().coordination.submitSwapPendingRef;
  useBridgeStreamEffects(
    {
      snapshot: session.snapshot,
      instrument: session.instrument,
      account: session.account,
      portfolio: session.portfolio,
      quote,
    },
    {
      chart: workspace.chart,
      positionOverlayState: workspace.positionOverlayState,
      tradingSyncTick: workspace.tradingSyncTick,
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
  session: ChartSession;
  ticket: Pick<TicketActions, 'clearStagedWidget'>;
}) {
  const quote = useBridgeQuote();
  useChartWorkspaceChartEffects(
    workspace,
    {
      instrument: session.instrument,
      loadingTimeframe: session.loadingTimeframe,
      snapshot: session.snapshot,
      setLoadingTimeframe: session.setLoadingTimeframe,
      setChartError: session.setChartError,
      currentSymbol: session.currentSymbol,
      setQuote: session.setQuote,
      setInstrument: session.setInstrument,
      targetSymbol: session.targetSymbol,
      status: session.status,
      quote,
    },
    ticket,
  );
  return null;
}

export function LifecycleAccountAndCheck({
  workspace,
  session,
  controls,
  accountRefs,
}: {
  workspace: ChartWorkspaceState;
  session: AccountSession;
  controls: TicketControls;
  accountRefs: AccountRefs;
}) {
  const { accountLoginRef, brokerServerRef } = accountRefs;
  useEffect(() => {
    accountLoginRef.current = session.account?.accountLogin;
    brokerServerRef.current = session.account?.brokerServer;
  }, [accountLoginRef, brokerServerRef, session.account?.accountLogin, session.account?.brokerServer]);
  const check = useOrderTicketCheckRuntime({
    snapshot: session.snapshot,
    status: session.status,
    account: session.account,
  });
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
  session: BootstrapSession;
  accountRefs: AccountRefs;
  ticketActions: TicketActions;
  ticketControls: TicketControls;
  bridgeTicket: BridgeTicketResponsePort;
}) {
  const { chart, adapterRef, fixedRangeProfileState, expectedProfile, profileGeneration } = workspace;
  const { accountLoginRef, brokerServerRef } = accountRefs;
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
  return null;
}

export function LifecycleTicketPreviewAndMirror({
  workspace,
  session,
  execution,
  dispatchEnabled,
}: {
  workspace: ChartWorkspaceState;
  session: PreviewSession;
  execution: Pick<ExecutionCommandState, 'requestModifyDraft' | 'requestClosePosition' | 'requestCancelOrder'>;
  dispatchEnabled: boolean;
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
  });
  useOrderTicketRiskPreviewEffects(preview.input, preview.riskBasis);
  useChartWorkspaceMirrorRefEffect(
    workspace,
    { instrument: session.instrument },
    { stagedOnChart: ticketChart.stagedOnChart },
    {
      requestModifyDraft: execution.requestModifyDraft,
      requestClosePosition: execution.requestClosePosition,
      requestCancelOrder: execution.requestCancelOrder,
    },
    dispatchEnabled,
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
