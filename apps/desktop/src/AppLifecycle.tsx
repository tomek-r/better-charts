import { useRef } from 'react';
import { useBridgeSessionLifecycleRuntime } from './features/bridge/BridgeSessionProvider';
import { useChartWorkspaceRuntime } from './features/chart/ChartWorkspaceProvider';
import { useExecutionRuntime } from './features/execution/ExecutionProvider';
import {
  useOrderTicketChartActions,
  useOrderTicketChartControls,
} from './features/order-ticket/state/useOrderTicketChartRuntime';
import { useOrderTicketBridgeResponsePort } from './features/order-ticket/state/useOrderTicketBridgeResponsePort';
import {
  LifecycleAccountAndCheck,
  LifecycleBootstrapAndGestures,
  LifecycleChartMarket,
  LifecycleInitialization,
  LifecyclePortfolioStream,
  LifecycleTicketEntry,
  LifecycleTicketPreviewAndMirror,
} from './lifecycle/AppLifecycleEffects';

/**
 * Keeps cross-domain lifecycle effects in their frozen registration order.
 * Quote subscriptions live only in the children whose effects need live prices.
 */
export function AppLifecycle() {
  const workspace = useChartWorkspaceRuntime();
  const session = useBridgeSessionLifecycleRuntime();
  const execution = useExecutionRuntime();
  const ticketActions = useOrderTicketChartActions();
  const ticketControls = useOrderTicketChartControls();
  const bridgeTicket = useOrderTicketBridgeResponsePort();
  const accountLoginRef = useRef<string | undefined>(undefined);
  const brokerServerRef = useRef<string | undefined>(undefined);
  const accountRefs = { accountLoginRef, brokerServerRef };

  return (
    <>
      <LifecycleInitialization
        workspace={workspace}
        session={{
          mounted: session.mounted,
          setChartError: session.setChartError,
          requestProfileRange: session.requestProfileRange,
        }}
        execution={execution}
      />
      <LifecyclePortfolioStream
        session={{
          snapshot: session.snapshot,
          instrument: session.instrument,
          account: session.account,
          portfolio: session.portfolio,
        }}
        workspace={workspace}
        ticket={ticketActions}
      />
      <LifecycleChartMarket
        workspace={workspace}
        session={{
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
        }}
        ticket={ticketActions}
      />
      <LifecycleAccountAndCheck
        workspace={workspace}
        session={{
          account: session.account,
          status: session.status,
          snapshot: session.snapshot,
          loadingTimeframeRef: session.loadingTimeframeRef,
          targetSymbol: session.targetSymbol,
          pendingMetadata: session.pendingMetadata,
          setLoadingTimeframe: session.setLoadingTimeframe,
          setQuote: session.setQuote,
          setInstrument: session.setInstrument,
          setAccount: session.setAccount,
          setPortfolio: session.setPortfolio,
          setSymbolLoading: session.setSymbolLoading,
        }}
        controls={ticketControls}
        accountRefs={accountRefs}
      />
      <LifecycleTicketEntry />
      <LifecycleBootstrapAndGestures
        workspace={workspace}
        session={{
          stores: session.stores,
          loadingTimeframeRef: session.loadingTimeframeRef,
          targetSymbol: session.targetSymbol,
          pendingMetadata: session.pendingMetadata,
          currentSymbol: session.currentSymbol,
          currentTimeframe: session.currentTimeframe,
          latestCandleRef: session.latestCandleRef,
          dataKeyRef: session.dataKeyRef,
        }}
        accountRefs={accountRefs}
        ticketActions={ticketActions}
        ticketControls={ticketControls}
        bridgeTicket={bridgeTicket}
      />
      <LifecycleTicketPreviewAndMirror
        workspace={workspace}
        session={{
          instrument: session.instrument,
          account: session.account,
          snapshot: session.snapshot,
          latestCandle: session.latestCandle,
          status: session.status,
        }}
        execution={{
          requestModifyDraft: execution.requestModifyDraft,
          requestClosePosition: execution.requestClosePosition,
          requestCancelOrder: execution.requestCancelOrder,
        }}
        dispatchEnabled={execution.executionQueue?.dispatchEnabled === true}
      />
    </>
  );
}
