import { AccountIcon } from '../../shared/ui/AccountIcon';
import { BankIcon } from '../../shared/ui/BankIcon';
import { MoneyIcon } from '../../shared/ui/MoneyIcon';
import { useAccountEnvironment } from './useAccountEnvironment';

/** Account environment (broker company, account number, kind) for the top bar — safety-relevant: which
 * environment an order would hit, so it stays visible even while the trade panel is closed. */
export function AccountBadge() {
  const environment = useAccountEnvironment();
  if (environment === undefined) {
    return null;
  }
  // The label ends with the account number and then the kind; a company comes first when the EA reports one.
  const [company, accountNumber, kindLabel] =
    environment.labelParts.length > 2 ? environment.labelParts : [undefined, ...environment.labelParts];
  // The icons mark the parts, so no separator; the real spaces keep the copied and read text apart.
  return (
    <span className="account-badge" title={environment.title}>
      {company === undefined ? null : (
        <>
          <span className="account-badge-part">
            <BankIcon className="account-badge-icon account-badge-bank" />
            {company}
          </span>{' '}
        </>
      )}
      <span className="account-badge-part">
        <AccountIcon className="account-badge-icon" />
        {accountNumber}
      </span>{' '}
      {/* Only the kind word carries the environment colour; the rest reads like the other top bar text. */}
      <span className={`account-badge-part account-badge-kind ${environment.kind}`}>
        {environment.kind === 'real' ? <MoneyIcon className="account-badge-money" /> : null}
        {kindLabel}
      </span>
    </span>
  );
}
