import type { BridgeStatus } from './types';

/** Why the bridge refused the EA, for the surfaces that explain or fix it. */
export enum BridgeRefusal {
  TokenMismatch = 'token-mismatch',
  ComponentOutdated = 'component-outdated',
  Other = 'other',
}

/** The refusal behind a protocol error; undefined for every other bridge state. */
export function bridgeRefusal(status: BridgeStatus): BridgeRefusal | undefined {
  if (status.state !== 'protocol_error') {
    return undefined;
  }
  if (status.tokenMismatch === true) {
    return BridgeRefusal.TokenMismatch;
  }
  if (status.componentOutdated === true) {
    return BridgeRefusal.ComponentOutdated;
  }
  return BridgeRefusal.Other;
}
