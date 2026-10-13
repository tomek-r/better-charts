import type { BridgeSessionStores } from './bridgeSessionStores';

export type HistoryWaitSetters = Pick<
  BridgeSessionStores['market']['setters'],
  'setHistoryWaitStartedAtMs' | 'setHistoryUnavailable'
>;

/** A new initial history request supersedes any earlier wait or "no data" outcome. */
export function beginHistoryWait(setters: HistoryWaitSetters): void {
  setters.setHistoryUnavailable(undefined);
  setters.setHistoryWaitStartedAtMs(Date.now());
}

/** Snapshot arrived, request failed, or the session was reset: nothing is pending any more. */
export function endHistoryWait(setters: HistoryWaitSetters): void {
  setters.setHistoryUnavailable(undefined);
  setters.setHistoryWaitStartedAtMs(undefined);
}
