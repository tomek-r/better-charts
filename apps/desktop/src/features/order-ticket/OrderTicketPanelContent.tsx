import { OrderTicketView } from './OrderTicketView';
import { AccountSummary } from '../portfolio/AccountSummary';
import { PortfolioView } from '../portfolio/PortfolioView';

export function OrderTicketPanelContent() {
  return (
    <>
      <OrderTicketView />
      <AccountSummary />
      <PortfolioView />
    </>
  );
}
