import type { ReactNode } from 'react';
import { OrderTicketProvider } from './OrderTicketProvider';
import { OrderTicketView } from './OrderTicketView';

/**
 * Ticket scope only: state and view. The app-wide lifecycle is passed in by the
 * composition root, because its effect slots must register inside this provider
 * but its ownership is not the ticket's.
 */
export function OrderTicketFeature({ children }: { children: ReactNode }) {
  return (
    <OrderTicketProvider>
      <OrderTicketView />
      {children}
    </OrderTicketProvider>
  );
}
