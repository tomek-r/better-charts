import { OrderTicketEditor } from './editor/OrderTicketEditor';
import { OrderTicketReview } from './review/OrderTicketReview';
import { useOrderTicketHeader, useOrderTicketReviewProps, useOrderTicketStage } from './OrderTicketProvider';
import { accountEnvironment } from './domain/ticketFormatting';

function ReviewBody() {
  return <OrderTicketReview {...useOrderTicketReviewProps()} />;
}

function TicketBody() {
  return useOrderTicketStage() === 'review' ? <ReviewBody /> : <OrderTicketEditor />;
}

export function OrderTicketView() {
  const { account, symbol } = useOrderTicketHeader();

  return (
    <section className="order-ticket" aria-label="Order ticket">
      <div className="ticket-header">
        <div className="ticket-title">
          <strong>{symbol ?? '—'}</strong>
          {account && (
            <span
              className={`ticket-account-badge ${accountEnvironment(account).kind}`}
              title={accountEnvironment(account).title}
            >
              {accountEnvironment(account).label}
            </span>
          )}
        </div>
      </div>
      <TicketBody />
    </section>
  );
}
