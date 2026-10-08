import type { TicketDerivation, TicketDerivationInput } from './ticketRules';
import { deriveOrderTicket } from './ticketRules';

export type TicketDerivationContext = Pick<
  TicketDerivationInput,
  'symbol' | 'bridgeState' | 'account' | 'instrument' | 'quote' | 'marketOpen'
>;

export type TicketDerivationDraft = Pick<
  TicketDerivationInput,
  | 'stagedOnChart'
  | 'riskSide'
  | 'entry'
  | 'stopLoss'
  | 'takeProfit'
  | 'slOn'
  | 'tpOn'
  | 'orderKind'
  | 'limitPrice'
  | 'timeInForce'
  | 'unitsMode'
  | 'equityAllocationPercent'
  | 'orderVolume'
  | 'draftVersion'
>;

export type TicketDerivationBroker = Pick<TicketDerivationInput, 'orderCheck' | 'riskPreview' | 'riskLoading'>;

/** Build only the domain inputs from canonical subscribed context, draft, and broker snapshots. */
export function buildTicketDerivationInput(
  context: TicketDerivationContext,
  draft: TicketDerivationDraft,
  broker: TicketDerivationBroker,
): TicketDerivationInput {
  return {
    symbol: context.symbol,
    bridgeState: context.bridgeState,
    account: context.account,
    stagedOnChart: draft.stagedOnChart,
    riskSide: draft.riskSide,
    entry: draft.entry,
    stopLoss: draft.stopLoss,
    takeProfit: draft.takeProfit,
    slOn: draft.slOn,
    tpOn: draft.tpOn,
    orderKind: draft.orderKind,
    limitPrice: draft.limitPrice,
    timeInForce: draft.timeInForce,
    unitsMode: draft.unitsMode,
    equityAllocationPercent: draft.equityAllocationPercent,
    orderVolume: draft.orderVolume,
    orderCheck: broker.orderCheck,
    riskPreview: broker.riskPreview,
    draftVersion: draft.draftVersion,
    riskLoading: broker.riskLoading,
    instrument: context.instrument,
    quote: context.quote,
    marketOpen: context.marketOpen,
  };
}

const ticketDerivationInputKeys = {
  symbol: true,
  bridgeState: true,
  account: true,
  stagedOnChart: true,
  riskSide: true,
  entry: true,
  stopLoss: true,
  takeProfit: true,
  slOn: true,
  tpOn: true,
  orderKind: true,
  limitPrice: true,
  timeInForce: true,
  unitsMode: true,
  equityAllocationPercent: true,
  orderVolume: true,
  orderCheck: true,
  riskPreview: true,
  draftVersion: true,
  riskLoading: true,
  instrument: true,
  quote: true,
  marketOpen: true,
} satisfies Record<keyof TicketDerivationInput, true>;

const ticketDerivationInputKeyList = Object.keys(ticketDerivationInputKeys) as Array<keyof TicketDerivationInput>;

/** One-entry pure memo; each ticket-store instance owns its own cache. */
export function createTicketDerivationCache(): (input: TicketDerivationInput) => TicketDerivation {
  let previousInput: TicketDerivationInput | undefined;
  let previousResult: TicketDerivation | undefined;

  return (input) => {
    if (
      previousInput &&
      previousResult &&
      ticketDerivationInputKeyList.every((key) => Object.is(previousInput?.[key], input[key]))
    ) {
      return previousResult;
    }

    const result = deriveOrderTicket(input);
    previousInput = { ...input };
    previousResult = result;
    return result;
  };
}
