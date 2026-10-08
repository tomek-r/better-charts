import { useOrderTicketBrokerActions } from './useOrderTicketBrokerActions';
import { useOrderTicketDraft } from './useOrderTicketDraft';
import { useOrderTicketPricing } from './useOrderTicketPricing';
import { useOrderTicketSizing } from './useOrderTicketSizing';
import type { OrderTicketInputs } from './orderTicketInputs';
import type { OrderTicketStores } from './orderTicketStores';

export type OrderTicketActionInputs = OrderTicketInputs & { stores: OrderTicketStores };

/** Build ticket commands from the draft, pricing, sizing, and broker hooks. */
export function useOrderTicketActionsProducer({ stores, ...inputs }: OrderTicketActionInputs) {
  const draft = useOrderTicketDraft(inputs, stores);
  const brokerActions = useOrderTicketBrokerActions(inputs, stores, draft.resetTicketToDefaults);
  const pricing = useOrderTicketPricing(inputs, stores);
  const sizing = useOrderTicketSizing(stores, draft.enableRiskStopLoss);

  return {
    ...pricing,
    ...draft,
    ...sizing,
    ...brokerActions,
  };
}
