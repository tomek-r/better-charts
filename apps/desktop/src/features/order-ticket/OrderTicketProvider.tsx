import { useMemo, useState, type ReactNode } from 'react';
import { useStableActions } from '../../shared/identity/useStableActions';
import { OrderTicketStoresContext } from './draft/orderTicketContext';
import { createOrderTicketStores } from './draft/orderTicketStores';
import { useOrderTicketActionsProducer } from './lifecycle/useOrderTicketActionsProducer';
import { useChartResources } from '../chart/ChartWorkspaceProvider';
import {
  useBridgeAccountSelector,
  useBridgeConnection,
  useBridgeMarketSelector,
  useBridgeQuote,
} from '../bridge/bridgeSelectors';

export function OrderTicketProvider({ children }: { children: ReactNode }) {
  const [stores] = useState(createOrderTicketStores);
  const { chart, stagedOrderState, instrumentDigitsRef, stagedActiveRef } = useChartResources();
  const { instrument, snapshot, latestCandle } = useBridgeMarketSelector((market) => market);
  const quote = useBridgeQuote();
  const account = useBridgeAccountSelector((value) => value);
  const { status } = useBridgeConnection();
  const ticketActions = useOrderTicketActionsProducer({
    chart,
    stagedOrderState,
    instrumentDigitsRef,
    stagedActiveRef,
    instrument,
    account,
    quote,
    snapshot,
    latestCandle,
    status,
    stores,
  });

  const actions = useStableActions(ticketActions);
  const injection = useMemo(() => ({ stores, actions }), [stores, actions]);

  return <OrderTicketStoresContext value={injection}>{children}</OrderTicketStoresContext>;
}
