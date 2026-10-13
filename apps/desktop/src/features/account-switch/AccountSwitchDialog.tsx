import { formatAccountMoney, formatMarginThreshold, marginModeName } from '../../shared/accountFormat';
import type { AccountSnapshot } from '../../shared/bridge/types';
import { ModalDialog, ModalDialogButton } from '../../shared/ui/ModalDialog';

/** Label/value rows of the new account; rows with a missing value are omitted. */
function accountInfoRows(account: AccountSnapshot | undefined): Array<[label: string, value: string]> {
  if (!account) {
    return [];
  }
  const balance = formatAccountMoney(account.balance, account);
  const equity = formatAccountMoney(account.equity, account);
  const marginCall = formatMarginThreshold(account.marginCallLevel, account);
  const stopOut = formatMarginThreshold(account.stopOutLevel, account);
  const rows: Array<[string, string | undefined]> = [
    ['Server', account.brokerServer],
    ['Balance', balance],
    ['Equity', equity !== balance ? equity : undefined],
    ['Leverage', account.leverage > 0 ? `1:${account.leverage}` : undefined],
    ['Account', marginModeName(account.marginMode)],
    ['Margin call / Stop out', marginCall && stopOut ? `${marginCall} · ${stopOut}` : undefined],
  ];
  return rows.filter((row): row is [string, string] => Boolean(row[1]));
}

/** Check mark when algo trading is on, warning triangle when it is off; colour from `currentColor`. */
function AlgoTradingIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      data-algo-icon={enabled ? 'check' : 'warning'}
    >
      {enabled ? (
        <>
          <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="m7.75 12.25 2.75 2.75 5.75-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <path
            d="M12 3.25 21.5 20H2.5L12 3.25Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path d="M12 9.5v4.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="12" cy="17.25" r="1.1" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/** Modal notice that the MT5 login changed; the only control is Dismiss. */
export function AccountSwitchDialog({
  message,
  account,
  tradingEnabled,
  onDismiss,
}: {
  message: string;
  account: AccountSnapshot | undefined;
  tradingEnabled: boolean;
  onDismiss: () => void;
}) {
  return (
    <ModalDialog
      title={message}
      onDismiss={onDismiss}
      actions={
        <ModalDialogButton variant="primary" onClick={onDismiss}>
          Dismiss
        </ModalDialogButton>
      }
    >
      <dl className="account-switch-info">
        {accountInfoRows(account).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p
        role="status"
        className={tradingEnabled ? 'account-switch-algo' : 'account-switch-algo warn'}
        data-algo-trading={tradingEnabled ? 'enabled' : 'disabled'}
      >
        <AlgoTradingIcon enabled={tradingEnabled} />
        {tradingEnabled ? 'Algo trading is enabled' : 'Turn on Algo Trading in MT5 in order to send orders'}
      </p>
    </ModalDialog>
  );
}
