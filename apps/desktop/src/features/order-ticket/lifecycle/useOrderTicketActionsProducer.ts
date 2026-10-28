import { useOrderTicketBrokerActions } from '../submit/useOrderTicketBrokerActions';
import { useOrderTicketDraft } from '../draft/useOrderTicketDraft';
import { useOrderTicketPricingActions } from '../pricing/useOrderTicketPricingActions';
import { useOrderTicketSizingActions } from '../sizing/useOrderTicketSizingActions';
import type { OrderTicketInputs } from '../draft/orderTicketInputs';
import type { OrderTicketStores } from '../draft/orderTicketStores';

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
