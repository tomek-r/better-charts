import type { ReactNode } from 'react';
import { formatAccountMoney, formatMarginThreshold, marginModeName } from '../../shared/accountFormat';
import type { AccountSnapshot } from '../../shared/bridge/types';
import { ModalDialog, ModalDialogButton } from '../../shared/ui/dialog/ModalDialog';
import { Separated } from '../../shared/ui/icons/SeparatorIcon';
import { AlgoTradingIcon } from './AlgoTradingIcon';

/** Label/value rows of the new account; rows with a missing value are omitted. */
function accountInfoRows(account: AccountSnapshot | undefined): Array<[label: string, value: ReactNode]> {
  if (!account) {
    return [];
  }
  const balance = formatAccountMoney(account.balance, account);
  const equity = formatAccountMoney(account.equity, account);
  const marginCall = formatMarginThreshold(account.marginCallLevel, account);
  const stopOut = formatMarginThreshold(account.stopOutLevel, account);
  const rows: Array<[string, ReactNode]> = [
    ['Server', account.brokerServer],
    ['Balance', balance],
    ['Equity', equity !== balance ? equity : undefined],
    ['Leverage', account.leverage > 0 ? `1:${account.leverage}` : undefined],
    ['Account', marginModeName(account.marginMode)],
    ['Margin call / Stop out', marginCall && stopOut ? <Separated parts={[marginCall, stopOut]} /> : undefined],
  ];
  return rows.filter((row): row is [string, ReactNode] => Boolean(row[1]));
}

const ALGO_TRADING_ENABLED = {
  className: 'account-switch-algo',
  dataState: 'enabled',
  text: 'Algo trading is enabled',
};
const ALGO_TRADING_DISABLED = {
  className: 'account-switch-algo warn',
  dataState: 'disabled',
  text: 'Turn on Algo Trading in MT5 in order to send orders',
};

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
  const algoTrading = tradingEnabled ? ALGO_TRADING_ENABLED : ALGO_TRADING_DISABLED;
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
      <p role="status" className={algoTrading.className} data-algo-trading={algoTrading.dataState}>
        <AlgoTradingIcon enabled={tradingEnabled} />
        {algoTrading.text}
      </p>
    </ModalDialog>
  );
}
