import { useBridgeAccount } from '../bridge/BridgeSessionProvider';
import { accountAmount } from './accountAmount';

const ACCOUNT_METRICS = [
  ['Balance', 'balance'],
  ['Equity', 'equity'],
  ['Margin', 'margin'],
  ['Free margin', 'freeMargin'],
  ['Margin level', 'marginLevel'],
] as const;

export function AccountSummary() {
  const account = useBridgeAccount();

  return (
    <dl className="portfolio-account" aria-label="Account state">
      {ACCOUNT_METRICS.map(([label, key]) => {
        const amount = accountAmount(
          account?.[key],
          key === 'marginLevel' ? undefined : account?.currency,
          account?.currencyDigits,
        );
        return (
          <div className="portfolio-account-row" key={key}>
            <dt>{label}</dt>
            <dd>{key === 'marginLevel' && amount !== '—' ? `${amount} %` : amount}</dd>
          </div>
        );
      })}
    </dl>
  );
}
