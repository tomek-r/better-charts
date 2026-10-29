import { OrderTicketQuotes } from './quotes/OrderTicketQuotes';
import { OrderTicketPricing } from './pricing/OrderTicketPricing';
import { OrderTicketTickValue } from './sizing/OrderTicketTickValue';
import { OrderTicketSizing } from './sizing/OrderTicketSizing';
import { OrderTicketExits } from './exits/OrderTicketExits';
import { OrderTicketExtraSettings } from './exits/OrderTicketExtraSettings';
import { OrderTicketReviewAction } from './review/OrderTicketReviewAction';

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
