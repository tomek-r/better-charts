import type { AccountSnapshot } from '../../shared/bridge/types';
import { EMPTY_VALUE } from '../../shared/format';
import { useBridgeAccount } from '../bridge/bridgeSelectors';
import { accountAmount, formatAccountAmount } from './accountAmount';

type AccountMetric = { label: string; key: 'balance' | 'equity' | 'margin' | 'freeMargin' | 'marginLevel' };

const ACCOUNT_METRICS: AccountMetric[] = [
  { label: 'Balance', key: 'balance' },
  { label: 'Equity', key: 'equity' },
  { label: 'Margin', key: 'margin' },
  { label: 'Free margin', key: 'freeMargin' },
  { label: 'Margin level', key: 'marginLevel' },
];

/** Margin level is a percentage; the other metrics are amounts in the account currency. */
function formatMetric({ key }: AccountMetric, account: AccountSnapshot | undefined): string {
  if (key !== 'marginLevel') {
    return formatAccountAmount(account?.[key], account);
  }
  const level = accountAmount(account?.marginLevel);
  return level === EMPTY_VALUE ? level : `${level} %`;
}

export function AccountSummary() {
  const account = useBridgeAccount();

  return (
    <dl className="portfolio-account" aria-label="Account state">
      {ACCOUNT_METRICS.map((metric) => (
        <div className="portfolio-account-row" key={metric.key}>
          <dt>{metric.label}</dt>
          <dd>{formatMetric(metric, account)}</dd>
        </div>
      ))}
    </dl>
  );
}
