import { useEffect, useState } from 'react';
import { INITIAL_HISTORY_SYNC_TIMEOUT_MS } from '../../shared/bridge/limits';

/** The wait notice appears once this little time is left before the EA's deadline. */
export const WAIT_NOTICE_LEAD_MS = 5_000;
const COUNTDOWN_TICK_MS = 250;

/**
 * Whole seconds the notice shows, counting down to the EA's synchronization
 * deadline; `undefined` while more than the lead time remains. Never below 1:
 * the "no data" answer follows the deadline by a transport delay, and the
 * notice must not flash empty in between.
 */
export function historyWaitSecondsLeft(elapsedMs: number): number | undefined {
  const remainingMs = INITIAL_HISTORY_SYNC_TIMEOUT_MS - elapsedMs;
  if (remainingMs > WAIT_NOTICE_LEAD_MS) {
    return undefined;
  }
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

interface Countdown {
  startedAtMs: number | undefined;
  secondsLeft: number | undefined;
}

/** One interval, alive only while an initial history request is pending. */
export function useHistoryWaitSecondsLeft(startedAtMs: number | undefined): number | undefined {
  const [countdown, setCountdown] = useState<Countdown>({ startedAtMs: undefined, secondsLeft: undefined });
  useEffect(() => {
    if (startedAtMs === undefined) {
      return;
    }
    const tick = () =>
      setCountdown((previous) => {
        const secondsLeft = historyWaitSecondsLeft(Date.now() - startedAtMs);
        return previous.startedAtMs === startedAtMs && previous.secondsLeft === secondsLeft
          ? previous
          : { startedAtMs, secondsLeft };
      });
    const timer = window.setInterval(tick, COUNTDOWN_TICK_MS);
    return () => window.clearInterval(timer);
  }, [startedAtMs]);
  // A value computed for an earlier request must never label a newer one.
  return countdown.startedAtMs === startedAtMs ? countdown.secondsLeft : undefined;
}
