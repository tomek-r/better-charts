import { useShallow } from 'zustand/react/shallow';
import type { AccountSnapshot } from '../../shared/bridge/types';
import { useBridgeAccountSelector } from '../bridge/bridgeSelectors';
import { accountEnvironment, type AccountEnvironment } from './accountEnvironment';

type EnvironmentInput = Parameters<typeof accountEnvironment>[0];

/** Only the fields the badge reads, so balance, equity or currency ticks leave it untouched. */
function selectEnvironmentInput(account: AccountSnapshot | undefined): EnvironmentInput {
  if (account === undefined) {
    return undefined;
  }
  return {
    accountLogin: account.accountLogin,
    brokerServer: account.brokerServer,
    accountTradeModeName: account.accountTradeModeName,
    accountTradeMode: account.accountTradeMode,
    accountCompany: account.accountCompany,
  };
}

/** Badge data of the connected account; `undefined` until the bridge reports one. */
export function useAccountEnvironment(): AccountEnvironment | undefined {
  const input = useBridgeAccountSelector(useShallow(selectEnvironmentInput));
  return input === undefined ? undefined : accountEnvironment(input);
}
