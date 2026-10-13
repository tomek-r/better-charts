import { useEffect, useRef } from 'react';
import { formatAccountMoney, formatMarginThreshold, marginModeName } from '../../shared/accountFormat';
import type { AccountSnapshot } from '../../shared/bridge/types';

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
  const dismiss = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dismiss.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Modal keystrokes must not reach the chart's order/drawing shortcuts.
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      } else if (event.key === 'Tab') {
        // Dismiss is the only control, so the focus trap is "stay on it".
        event.preventDefault();
        dismiss.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [onDismiss]);
  return (
    <div className="account-switch-backdrop">
      <div
        className="account-switch-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-switch-title"
        data-account-switch-dialog
      >
        <h2 id="account-switch-title">{message}</h2>
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
          {tradingEnabled
            ? 'Algo trading is enabled'
            : "Algo trading is disabled in MT5 — orders can't be sent. Turn on Algo Trading in MT5."}
        </p>
        <button ref={dismiss} type="button" className="account-switch-dismiss" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
