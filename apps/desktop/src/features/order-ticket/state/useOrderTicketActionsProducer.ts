import { useOrderTicketBrokerActions } from './useOrderTicketBrokerActions';
import { useOrderTicketDraft } from './useOrderTicketDraft';
import { useOrderTicketPricingActions } from './useOrderTicketPricingActions';
import { useOrderTicketSizingActions } from './useOrderTicketSizingActions';
import type { OrderTicketInputs } from './orderTicketInputs';
import type { OrderTicketStores } from './orderTicketStores';

export type OrderTicketActionInputs = OrderTicketInputs & { stores: OrderTicketStores };

/** Build ticket commands from the draft, pricing, sizing, and broker hooks. */
export function useOrderTicketActionsProducer({ stores, ...inputs }: OrderTicketActionInputs) {
  const draft = useOrderTicketDraft(inputs, stores);
  const brokerActions = useOrderTicketBrokerActions(inputs, stores, draft.resetTicketToDefaults);
  const pricing = useOrderTicketPricingActions(inputs, stores);
  const sizing = useOrderTicketSizingActions(stores, inputs.instrument, draft.enableRiskStopLoss);

  return {
    ...pricing,
    ...draft,
    ...sizing,
    ...brokerActions,
  };
}
