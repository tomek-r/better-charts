import { OrderTicketEditor } from './editor/OrderTicketEditor';
import { OrderTicketReview } from './review/OrderTicketReview';
import { useOrderTicketHeader } from './editor/useOrderTicketHeader';
import { useOrderTicketReviewProps } from './editor/useOrderTicketReviewProps';
import { useOrderTicketStage } from './editor/useOrderTicketStage';

function OrderTicketReviewBody() {
  return <OrderTicketReview {...useOrderTicketReviewProps()} />;
}

function OrderTicketBody() {
  return useOrderTicketStage() === 'review' ? <OrderTicketReviewBody /> : <OrderTicketEditor />;
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
      <OrderTicketBody />
    </section>
  );
}
