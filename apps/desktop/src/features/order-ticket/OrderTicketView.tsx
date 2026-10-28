import { OrderTicketEditor } from './editor/OrderTicketEditor';
import { OrderTicketReview } from './review/OrderTicketReview';
import { useOrderTicketHeader } from './editor/useOrderTicketHeader';
import { useOrderTicketReviewProps } from './review/useOrderTicketReviewProps';
import { useOrderTicketStage } from './editor/useOrderTicketStage';

function OrderTicketReviewBody() {
  return <OrderTicketReview {...useOrderTicketReviewProps()} />;
}

function OrderTicketBody() {
  return useOrderTicketStage() === 'review' ? <OrderTicketReviewBody /> : <OrderTicketEditor />;
}

export function OrderTicketView() {
  const symbol = useOrderTicketHeader();

  return (
    <section className="order-ticket" aria-label="Order ticket">
      <div className="ticket-header">
        <div className="ticket-title">
          <strong>{symbol ?? '—'}</strong>
        </div>
      </div>
      <OrderTicketBody />
    </section>
  );
}
