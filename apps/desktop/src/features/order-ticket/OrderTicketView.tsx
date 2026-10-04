import { OrderTicket } from './OrderTicket';
import { OrderTicketEdit } from './OrderTicketEdit';
import { OrderTicketReview } from './OrderTicketReview';
import {
  useOrderTicketEditProps,
  useOrderTicketHeader,
  useOrderTicketReviewProps,
  useOrderTicketStage,
} from './OrderTicketProvider';

function ReviewBody() {
  return <OrderTicketReview {...useOrderTicketReviewProps()} />;
}

function EditBody() {
  return <OrderTicketEdit {...useOrderTicketEditProps()} />;
}

function TicketBody() {
  return useOrderTicketStage() === 'review' ? <ReviewBody /> : <EditBody />;
}

export function OrderTicketView() {
  const { account, symbol } = useOrderTicketHeader();
  return (
    <OrderTicket account={account} symbol={symbol}>
      <TicketBody />
    </OrderTicket>
  );
}
