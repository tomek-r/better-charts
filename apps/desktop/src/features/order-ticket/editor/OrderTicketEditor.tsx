import { OrderTicketQuotes } from './OrderTicketQuotes';
import { OrderTicketPricing } from './OrderTicketPricing';
import { OrderTicketTickValue } from './OrderTicketTickValue';
import { OrderTicketSizing } from './OrderTicketSizing';
import { OrderTicketExits } from './OrderTicketExits';
import { OrderTicketExtraSettings } from './OrderTicketExtraSettings';
import { OrderTicketReviewAction } from './OrderTicketReviewAction';

export function OrderTicketEditor() {
  return (
    <>
      <OrderTicketQuotes />
      <OrderTicketPricing />
      <OrderTicketSizing />
      <OrderTicketTickValue />
      <OrderTicketExits />
      <OrderTicketExtraSettings />
      <OrderTicketReviewAction />
    </>
  );
}
