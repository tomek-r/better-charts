import type { AccountSnapshot } from '../../../shared/bridge/types';

/** Account-environment badge data: prefers the backend's `accountTradeModeName`,
 * falls back to the raw enum int (0 demo / 1 contest / 2 real), else unknown —
 * tolerant of older payloads missing both fields. Safety-relevant: which
 * environment an order would hit, shown with the account number. */
export function accountEnvironment(
  account?: Partial<
    Pick<AccountSnapshot, 'accountTradeModeName' | 'accountTradeMode' | 'brokerServer' | 'accountLogin'>
  >,
): {
  kind: 'demo' | 'contest' | 'real' | 'unknown';
  label: string;
  title: string;
} {
  const name = account?.accountTradeModeName;
  const mode = account?.accountTradeMode;
  let kind: 'demo' | 'contest' | 'real' | 'unknown';
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
  const server = account?.brokerServer ? ` · ${account.brokerServer}` : '';
  return {
    kind,
    label: `${kind.toUpperCase()} · ${account?.accountLogin ?? '—'}`,
    title: `account_trade_mode=${mode ?? 'unknown'}${server}`,
  };
}

export function formatQuoted(value?: number) {
  if (value === undefined) {
    return '—';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}
export function formatOrderMetric(value?: string | null, suffix = '') {
  return value === undefined || value === null || value === '' ? '—' : `${value}${suffix}`;
}
