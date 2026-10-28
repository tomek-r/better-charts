import { useOrderTicketAction } from '../submit/useOrderTicketAction';
import { CHECKING_LABEL } from './ticketFormatting';

export function OrderTicketReviewAction() {
  const { side: riskSide, canCheckOrder, orderCheckLoading, startOrderReview } = useOrderTicketAction();
  return (
    <button
      className={`ticket-cta side-${riskSide}`}
      disabled={!canCheckOrder || orderCheckLoading}
      aria-busy={orderCheckLoading}
      onClick={startOrderReview}
    >
      {orderCheckLoading ? CHECKING_LABEL : 'Start creating order'}
    </button>
  );
}
