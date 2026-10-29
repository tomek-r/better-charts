import type { AccountSnapshot } from '../../shared/bridge/types';
import { EMPTY_VALUE } from '../../shared/format';

export type EnvironmentKind = 'demo' | 'contest' | 'real' | 'unknown';

/** The account fields the environment is derived from. */
export type AccountEnvironmentInput = Partial<
  Pick<
    AccountSnapshot,
    'accountTradeModeName' | 'accountTradeMode' | 'brokerServer' | 'accountLogin' | 'accountCompany'
  >
>;

/** Account-environment badge data: the environment kind, the label parts and the tooltip title. */
export interface AccountEnvironment {
  kind: EnvironmentKind;
  /** The broker company, when the EA reports one. */
  company: string | undefined;
  accountNumber: string;
  kindLabel: string;
  /** The badge label in its parts: the broker company when known, the account number, then the environment kind (always last). */
  labelParts: string[];
  title: string;
}

// ENUM_ACCOUNT_TRADE_MODE: 0 demo, 1 contest, 2 real.
const KIND_BY_TRADE_MODE: Partial<Record<number, EnvironmentKind>> = { 0: 'demo', 1: 'contest', 2: 'real' };

/** Badge wording for an environment kind: "Real", "Demo", "Contest", "Unknown" (only the colour marks it). */
export function environmentLabel(kind: EnvironmentKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Demo and contest accounts trade on simulated funds. */
export function isSimulatedEnvironment(kind: EnvironmentKind | undefined): boolean {
  return kind === 'demo' || kind === 'contest';
}

/** Environment of the connected account: prefers the backend's `accountTradeModeName`,
 * falls back to the raw enum int (0 demo / 1 contest / 2 real), else unknown —
 * tolerant of older payloads missing both fields. Safety-relevant: which
 * environment an order would hit, shown with the account number. */
export function accountEnvironment(account?: AccountEnvironmentInput): AccountEnvironment {
  const name = account?.accountTradeModeName;
  const mode = account?.accountTradeMode;
  let kind: EnvironmentKind;
  if (name === 'demo' || name === 'contest' || name === 'real') {
    kind = name;
  } else {
    kind = (mode === undefined ? undefined : KIND_BY_TRADE_MODE[mode]) ?? 'unknown';
  }
  const server = account?.brokerServer ? `, ${account.brokerServer}` : '';
  const company = account?.accountCompany || undefined;
  const accountNumber = account?.accountLogin ?? EMPTY_VALUE;
  const kindLabel = environmentLabel(kind);
  return {
    kind,
    company,
    accountNumber,
    kindLabel,
    labelParts: [...(company ? [company] : []), accountNumber, kindLabel],
    title: `account_trade_mode=${mode ?? 'unknown'}${server}`,
  };
}
