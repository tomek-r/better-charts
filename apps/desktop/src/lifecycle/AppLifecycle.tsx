import { useRef } from 'react';
import { useBridgeSessionLifecycleRuntime } from '../features/bridge/BridgeSessionProvider';
import { useChartWorkspaceRuntime } from '../features/chart/ChartWorkspaceProvider';
import { useExecutionRuntime } from '../features/execution/ExecutionProvider';
import {
  useOrderTicketChartActions,
  useOrderTicketChartControls,
} from '../features/order-ticket/stagedOrder/useOrderTicketChartRuntime';
import { useOrderTicketBridgeResponsePort } from '../features/order-ticket/lifecycle/useOrderTicketBridgeResponsePort';
import {
  LifecycleAccountAndCheck,
  LifecycleBootstrapAndGestures,
  LifecycleChartMarket,
  LifecycleInitialization,
  LifecyclePortfolioStream,
  LifecycleTicketEntry,
  LifecycleTicketPreviewAndMirror,
} from './AppLifecycleEffects';

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
      <LifecycleInitialization workspace={workspace} session={session} execution={execution} />
      <LifecyclePortfolioStream session={session} workspace={workspace} ticket={ticketActions} />
      <LifecycleChartMarket workspace={workspace} session={session} ticket={ticketActions} />
      <LifecycleAccountAndCheck
        workspace={workspace}
        session={session}
        controls={ticketControls}
        accountRefs={accountRefs}
      />
      <LifecycleTicketEntry />
      <LifecycleBootstrapAndGestures
        workspace={workspace}
        session={session}
        accountRefs={accountRefs}
        ticketActions={ticketActions}
        ticketControls={ticketControls}
        bridgeTicket={bridgeTicket}
      />
      <LifecycleTicketPreviewAndMirror workspace={workspace} session={session} execution={execution} />
    </>
  );
}
