import type { ReactNode } from 'react';
import type { AccountSnapshot } from '../../shared/bridge/types';
import { accountEnvironment } from './ticketFormatting';

export function OrderTicket({
  account,
  symbol,
  children,
}: {
  account: AccountSnapshot | undefined;
  symbol: string | undefined;
  children: ReactNode;
}) {
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
      {children}
    </section>
  );
}
