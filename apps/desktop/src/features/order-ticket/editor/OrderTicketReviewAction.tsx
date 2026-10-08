import { useOrderTicketAction } from './useOrderTicketAction';

export function OrderTicketReviewAction() {
  const { side: riskSide, canCheckOrder, orderCheckLoading, startOrderReview } = useOrderTicketAction();
  return (
    <button
      className={`ticket-cta side-${riskSide}`}
      disabled={!canCheckOrder || orderCheckLoading}
      aria-busy={orderCheckLoading}
      onClick={startOrderReview}
    >
      {orderCheckLoading ? 'Checking with MT5…' : 'Start creating order'}
    </button>
  );
}
