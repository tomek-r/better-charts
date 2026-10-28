import { AccountIcon } from './AccountIcon';
import { BankIcon } from './BankIcon';
import { MoneyIcon } from './MoneyIcon';
import { useAccountEnvironment } from './useAccountEnvironment';

/** Account environment (broker company, account number, kind) for the top bar — safety-relevant: which
 * environment an order would hit, so it stays visible even while the trade panel is closed. */
export function AccountBadge() {
  const environment = useAccountEnvironment();
  if (environment === undefined) {
    return null;
  }
  const { company, accountNumber, kindLabel } = environment;
  // The icons mark the parts, so no separator; the real spaces keep the copied and read text apart.
  return (
    <span className="account-badge" title={environment.title}>
      {company === undefined ? null : (
        <>
          <span className="account-badge-part">
            <BankIcon className="account-badge-icon account-badge-bank" />
            <span className="account-badge-company">{company}</span>
          </span>{' '}
        </>
      )}
      <span className="account-badge-part">
        <AccountIcon className="account-badge-icon" />
        {accountNumber}
      </span>{' '}
      {/* The kind reads like the rest of the badge; the word itself names the environment. */}
      <span className={`account-badge-part account-badge-kind ${environment.kind}`}>
        <MoneyIcon className="account-badge-money" />
        {kindLabel}
      </span>
    </span>
  );
}
