import { useMemo } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import { useBridgeSessionStores } from '../../bridge/BridgeSessionProvider';
import type { BridgeSessionStores } from '../../bridge/bridgeSessionStores';
import { deriveTicketGateProjection } from './useOrderTicketGates';
import { useOrderTicketActions, useOrderTicketStores } from '../state/orderTicketContext';
import type { OrderTicketStores } from '../state/orderTicketStores';
import type { OrderTicketActionProps } from './orderTicketEditorTypes';

type TicketActionSnapshot = Pick<OrderTicketActionProps, 'canCheckOrder' | 'orderCheckLoading' | 'side'>;
type TicketActionSourceStates = {
  draft: ReturnType<OrderTicketStores['draft']['getState']>;
  broker: ReturnType<OrderTicketStores['broker']['getState']>;
  bridgeState: ReturnType<BridgeSessionStores['connection']['getState']>['status']['state'];
  marketOpen: boolean | undefined;
  symbol: ReturnType<BridgeSessionStores['market']['getState']>['snapshot']['symbol'];
  instrument: ReturnType<BridgeSessionStores['market']['getState']>['instrument'];
  quote: ReturnType<BridgeSessionStores['quote']['getState']>['quote'] | undefined;
  accountLogin: string | undefined;
  brokerServer: string | undefined;
};
type TicketActionSelectorStore = Pick<StoreApi<TicketActionSnapshot>, 'getState' | 'getInitialState' | 'subscribe'>;

function createTicketActionSelectorStore(ticket: OrderTicketStores, bridge: BridgeSessionStores) {
  const normalizeSources = (
    draft: TicketActionSourceStates['draft'],
    broker: TicketActionSourceStates['broker'],
    connection: ReturnType<BridgeSessionStores['connection']['getState']>,
    market: ReturnType<BridgeSessionStores['market']['getState']>,
    quote: ReturnType<BridgeSessionStores['quote']['getState']>,
    account: ReturnType<BridgeSessionStores['account']['getState']>,
  ): TicketActionSourceStates => ({
    draft,
    broker,
    bridgeState: connection.status.state,
    marketOpen: connection.status.marketSession?.isOpen,
    symbol: market.snapshot.symbol,
    instrument: market.instrument,
    quote: draft.stagedOnChart && draft.orderKind === 'market' ? quote.quote : undefined,
    accountLogin: account.account?.accountLogin,
    brokerServer: account.account?.brokerServer,
  });
  const readCurrentSources = (): TicketActionSourceStates =>
    normalizeSources(
      ticket.draft.getState(),
      ticket.broker.getState(),
      bridge.connection.getState(),
      bridge.market.getState(),
      bridge.quote.getState(),
      bridge.account.getState(),
    );
  const readInitialSources = (): TicketActionSourceStates =>
    normalizeSources(
      ticket.draft.getInitialState(),
      ticket.broker.getInitialState(),
      bridge.connection.getInitialState(),
      bridge.market.getInitialState(),
      bridge.quote.getInitialState(),
      bridge.account.getInitialState(),
    );
  const select = (sources: TicketActionSourceStates): TicketActionSnapshot => {
    const { draft, broker } = sources;
    const gate = deriveTicketGateProjection({
      symbol: sources.symbol,
      instrument: sources.instrument,
      bridgeState: sources.bridgeState,
      marketOpen: sources.marketOpen,
      accountLogin: sources.accountLogin,
      brokerServer: sources.brokerServer,
      draft,
      broker,
      quote: sources.quote,
    });
    return { canCheckOrder: gate.canCheckOrder, orderCheckLoading: broker.orderCheckLoading, side: draft.riskSide };
  };
  const sameSources = (left: TicketActionSourceStates, right: TicketActionSourceStates) =>
    left.draft === right.draft &&
    left.broker === right.broker &&
    left.bridgeState === right.bridgeState &&
    left.marketOpen === right.marketOpen &&
    left.symbol === right.symbol &&
    left.instrument === right.instrument &&
    left.quote === right.quote &&
    left.accountLogin === right.accountLogin &&
    left.brokerServer === right.brokerServer;
  const sameSelection = (left: TicketActionSnapshot, right: TicketActionSnapshot) =>
    left.canCheckOrder === right.canCheckOrder &&
    left.orderCheckLoading === right.orderCheckLoading &&
    left.side === right.side;

  const initialSources = readInitialSources();
  const initialSelection = select(initialSources);
  let latestSources = initialSources;
  let latestSelection = initialSelection;
  const getState = () => {
    const sources = readCurrentSources();
    if (sameSources(latestSources, sources)) {
      return latestSelection;
    }
    const selection = select(sources);
    latestSources = sources;
    if (!sameSelection(latestSelection, selection)) {
      latestSelection = selection;
    }
    return latestSelection;
  };
  const subscribe: TicketActionSelectorStore['subscribe'] = (listener) => {
    let previous = getState();
    const notify = () => {
      const current = getState();
      if (current !== previous) {
        const previousSnapshot = previous;
        previous = current;
        listener(current, previousSnapshot);
      }
    };
    const unsubscribers = [
      ticket.draft.subscribe(notify),
      ticket.broker.subscribe(notify),
      bridge.connection.subscribe(notify),
      bridge.market.subscribe(notify),
      bridge.quote.subscribe(notify),
      bridge.account.subscribe(notify),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  };
  return {
    getState,
    getInitialState: () => initialSelection,
    subscribe,
  } satisfies TicketActionSelectorStore;
}

export function useOrderTicketAction(): OrderTicketActionProps {
  const stores = useOrderTicketStores();
  const bridgeStores = useBridgeSessionStores();
  const actions = useOrderTicketActions();
  const selectorStore = useMemo(() => createTicketActionSelectorStore(stores, bridgeStores), [stores, bridgeStores]);
  const selection = useStore(selectorStore);
  return {
    ...selection,
    startOrderReview: actions.startOrderReview,
  };
}
