import { OrderTicketEditor } from './editor/OrderTicketEditor';
import { OrderTicketReview } from './review/OrderTicketReview';
import { useOrderTicketHeader, useOrderTicketReviewProps, useOrderTicketStage } from './editor/orderTicketGateViews';

function ReviewBody() {
  return <OrderTicketReview {...useOrderTicketReviewProps()} />;
}

function TicketBody() {
  return useOrderTicketStage() === 'review' ? <ReviewBody /> : <OrderTicketEditor />;
}

export function OrderTicketView() {
  const { environment, symbol } = useOrderTicketHeader();

  return (
    <section className="order-ticket" aria-label="Order ticket">
      <div className="ticket-header">
        <div className="ticket-title">
          <strong>{symbol ?? '—'}</strong>
          {environment && (
            <span className={`ticket-account-badge ${environment.kind}`} title={environment.title}>
              {environment.label}
            </span>
          )}
        </div>
      </div>
      <TicketBody />
    </section>
  );
}
