import type { AccountSnapshot } from '../../shared/bridge/types';

/** Account-environment badge data: the environment kind, the label parts and the tooltip title. */
export interface AccountEnvironment {
  kind: 'demo' | 'contest' | 'real' | 'unknown';
  /** The badge label in its parts: the broker company when known, the account number, then the environment kind (always last). */
  labelParts: string[];
  title: string;
}

/** Badge wording for an environment kind: "Real", "Demo", "Contest", "Unknown" (only the colour marks it). */
function environmentLabel(kind: AccountEnvironment['kind']): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Environment of the connected account: prefers the backend's `accountTradeModeName`,
 * falls back to the raw enum int (0 demo / 1 contest / 2 real), else unknown —
 * tolerant of older payloads missing both fields. Safety-relevant: which
 * environment an order would hit, shown with the account number. */
export function accountEnvironment(
  account?: Partial<
    Pick<
      AccountSnapshot,
      'accountTradeModeName' | 'accountTradeMode' | 'brokerServer' | 'accountLogin' | 'accountCompany'
    >
  >,
): AccountEnvironment {
  const name = account?.accountTradeModeName;
  const mode = account?.accountTradeMode;
  let kind: AccountEnvironment['kind'];
  if (name === 'demo' || name === 'contest' || name === 'real') {
    kind = name;
  } else if (mode === 0) {
    kind = 'demo';
  } else if (mode === 1) {
    kind = 'contest';
  } else if (mode === 2) {
    kind = 'real';
  } else {
    kind = 'unknown';
  }
  const server = account?.brokerServer ? `, ${account.brokerServer}` : '';
  const company = account?.accountCompany;
  return {
    kind,
    labelParts: [...(company ? [company] : []), account?.accountLogin ?? '—', environmentLabel(kind)],
    title: `account_trade_mode=${mode ?? 'unknown'}${server}`,
  };
}
