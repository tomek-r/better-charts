import type { AccountSnapshot } from '../../shared/bridge/types';
import { accountEnvironment } from '../account-badge/accountEnvironment';

export type AccountIdentity = Pick<AccountSnapshot, 'accountLogin' | 'brokerServer'>;

/**
 * A switch is a different login or server than the last account this app run
 * saw. The first account and a reconnect to the same account are not switches.
 */
export function isAccountSwitch(previous: AccountIdentity | undefined, next: AccountIdentity): boolean {
  return (
    previous !== undefined &&
    (previous.accountLogin !== next.accountLogin || previous.brokerServer !== next.brokerServer)
  );
}

/** "Account was switched to Demo 19219321" — the environment is part of the safety message. */
export function accountSwitchMessage(account: AccountSnapshot): string {
  const { kind } = accountEnvironment(account);
  const environment = kind === 'unknown' ? '' : `${kind.charAt(0).toUpperCase()}${kind.slice(1)} `;
  return `Account was switched to ${environment}${account.accountLogin}`;
}
