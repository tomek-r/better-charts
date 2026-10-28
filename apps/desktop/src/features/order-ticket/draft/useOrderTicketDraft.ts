import { useOrderTicketSideFlip } from '../sideFlip/useOrderTicketSideFlip';
import { useOrderTicketStaging } from '../stagedOrder/useOrderTicketStaging';
import type { OrderTicketInputs } from './orderTicketInputs';
import type { OrderTicketStores } from './orderTicketStores';
import { useOrderTicketResets } from './useOrderTicketResets';

type DraftInputs = Pick<
  OrderTicketInputs,
  | 'chart'
  | 'stagedOrderState'
  | 'instrumentDigitsRef'
  | 'stagedActiveRef'
  | 'instrument'
  | 'snapshot'
  | 'latestCandle'
  | 'quote'
>;

export function useOrderTicketDraft(inputs: DraftInputs, stores: OrderTicketStores) {
  const { resetOrderDraft, resetTicketToDefaults } = useOrderTicketResets(inputs.instrument, stores);
  const { enableRiskStopLoss, quoteEntryFor, stageOrderDraft, clearStagedWidget, unstageOrderDraft } =
    useOrderTicketStaging(inputs, stores, resetOrderDraft);
  const stageFromQuote = useOrderTicketSideFlip(inputs, stores, { resetOrderDraft, stageOrderDraft, quoteEntryFor });

  return {
    resetOrderDraft,
    resetTicketToDefaults,
    enableRiskStopLoss,
    stageOrderDraft,
    clearStagedWidget,
    unstageOrderDraft,
    stageFromQuote,
  };
}
