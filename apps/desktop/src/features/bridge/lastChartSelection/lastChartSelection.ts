import { timeframeOptions } from '../../../shared/bridge/timeframes';

/** The chart window one account was last watching: a symbol and a timeframe, nothing else. */
export interface LastChartSelection {
  symbol: string;
  timeframe: string;
}

export const lastChartSelectionKey = 'better-charts.last-chart-selection.v1';

// The session's default window is on screen before the saved one is read. Until the
// start has decided what to reopen, persisting would overwrite the saved window with
// that default. One app run decides once, so this is page-wide state.
let startRestoreSettled = false;

export function settleStartRestore(): void {
  startRestoreSettled = true;
}

export function isStartRestoreSettled(): boolean {
  return startRestoreSettled;
}

/** One entry per account identity; the identity itself is the storage key. */
type StoredSelections = Record<string, LastChartSelection>;

const knownTimeframes = new Set(timeframeOptions.map((option) => option.wire));

/**
 * Storage key for one account. Both halves are required, so a half identity is
 * never stored and one account's entry can never answer another's.
 */
export function accountIdentityKey(login: string | undefined, server: string | undefined): string | undefined {
  const trimmedLogin = login?.trim();
  const trimmedServer = server?.trim();
  if (!trimmedLogin || !trimmedServer) {
    return undefined;
  }
  return `${trimmedLogin}@${trimmedServer}`;
}

/** True when both describe the same window; a missing side never matches. */
export function isSameChartSelection(
  first: LastChartSelection | undefined,
  second: LastChartSelection | undefined,
): boolean {
  return Boolean(first && second && first.symbol === second.symbol && first.timeframe === second.timeframe);
}

/**
 * The saved selection when its timeframe is one this app serves: a
 * `config/timeframes.json` code and, when the handshake advertises any, one of
 * those. An empty handshake list means "not reported", as in the timeframe bar.
 */
export function restorableSelection(
  selection: LastChartSelection | undefined,
  supportedTimeframes: readonly string[] | undefined,
): LastChartSelection | undefined {
  if (!selection || !knownTimeframes.has(selection.timeframe)) {
    return undefined;
  }
  const served = supportedTimeframes?.length ? supportedTimeframes : [...knownTimeframes];
  return served.includes(selection.timeframe) ? selection : undefined;
}

function readSelection(value: unknown): LastChartSelection | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const { symbol, timeframe } = value as Record<string, unknown>;
  if (typeof symbol !== 'string' || typeof timeframe !== 'string' || !symbol || !timeframe) {
    return undefined;
  }
  return { symbol, timeframe };
}

/** Every readable entry; anything that is not a symbol+timeframe pair is dropped. */
function readSelections(storage: Pick<Storage, 'getItem'>): StoredSelections {
  let value: unknown;
  try {
    value = JSON.parse(storage.getItem(lastChartSelectionKey) ?? '{}');
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    // Unreadable text is replaced by the next save instead of blocking it.
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const selections: StoredSelections = {};
  for (const [accountKey, entry] of Object.entries(value as Record<string, unknown>)) {
    const selection = readSelection(entry);
    if (selection) {
      selections[accountKey] = selection;
    }
  }
  return selections;
}

/** The selection stored for `accountKey`; missing, malformed or foreign storage reads as none. */
export function loadLastChartSelection(
  accountKey: string | undefined,
  storage?: Pick<Storage, 'getItem'>,
): LastChartSelection | undefined {
  if (!accountKey) {
    return undefined;
  }
  try {
    return readSelections(storage ?? localStorage)[accountKey];
  } catch {
    return undefined;
  }
}

/** Replaces the entry of `accountKey`; storage is optional, so a refusal is silent. */
export function saveLastChartSelection(
  accountKey: string | undefined,
  selection: LastChartSelection,
  storage?: Pick<Storage, 'getItem' | 'setItem'>,
): void {
  if (!accountKey) {
    return;
  }
  try {
    const target = storage ?? localStorage;
    const selections = readSelections(target);
    selections[accountKey] = { symbol: selection.symbol, timeframe: selection.timeframe };
    target.setItem(lastChartSelectionKey, JSON.stringify(selections));
  } catch {
    /* storage is optional */
  }
}
