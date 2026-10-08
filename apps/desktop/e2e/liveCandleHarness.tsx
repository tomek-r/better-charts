import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppLifecycle } from '../src/AppLifecycle';
import { BridgeSessionProvider, useBridgeSessionRuntime } from '../src/features/bridge/BridgeSessionProvider';
import { ChartWorkspaceProvider, useChartWorkspaceRuntime } from '../src/features/chart/ChartWorkspaceProvider';
import { ChartCanvas } from '../src/features/chart/ChartCanvas';
import { ExecutionProvider } from '../src/features/execution/ExecutionProvider';
import { OrderTicketProvider } from '../src/features/order-ticket/OrderTicketProvider';
import { useOrderTicketActions, useOrderTicketStores } from '../src/features/order-ticket/state/orderTicketContext';
import { ErrorNotificationsProvider } from '../src/shared/ui/ErrorNotifications';
import type { Candle } from '../src/shared/bridge/types';
import { useStore } from 'zustand';

function LiveProbe() {
  const session = useBridgeSessionRuntime();
  const workspace = useChartWorkspaceRuntime();
  const stores = useOrderTicketStores();
  const actions = useOrderTicketActions();
  const entry = useStore(stores.draft, (draft) => draft.entry);
  useEffect(() => {
    const target = window as unknown as {
      __initialLiveHistory?: Candle[];
      __readLiveProbe?: () => unknown;
    };
    if (session.snapshot.symbol && !target.__initialLiveHistory) {
      target.__initialLiveHistory = session.snapshot.candles;
    }
    target.__readLiveProbe = () => ({
      historyStable: target.__initialLiveHistory === session.snapshot.candles,
      historyLength: session.snapshot.candles.length,
      latest: session.latestCandle,
      currentPrice: workspace.stagedOrderState.current.currentPrice,
    });
  }, [session, workspace]);
  return (
    <>
      <output data-testid="live-close">{session.latestCandle?.close}</output>
      <output data-testid="live-entry">{entry}</output>
      <button onClick={() => actions.stageOrderDraft('buy', true)}>Stage live fallback</button>
    </>
  );
}

export function mountLiveCandleHarness(container: HTMLElement) {
  createRoot(container).render(
    <ErrorNotificationsProvider>
      <ChartWorkspaceProvider>
        <BridgeSessionProvider>
          <ExecutionProvider>
            <ChartCanvas />
            <OrderTicketProvider>
              <AppLifecycle />
              <LiveProbe />
            </OrderTicketProvider>
          </ExecutionProvider>
        </BridgeSessionProvider>
      </ChartWorkspaceProvider>
    </ErrorNotificationsProvider>,
  );
}
