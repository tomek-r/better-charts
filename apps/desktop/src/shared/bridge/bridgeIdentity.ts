import type { BridgeStatus } from './types';

/** Which terminal, account and server a status describes; a change means a different MT5 session. */
export function bridgeIdentityKey(status: Pick<BridgeStatus, 'terminal' | 'account' | 'server'>): string {
  return `${status.terminal ?? ''}|${status.account ?? ''}|${status.server ?? ''}`;
}
