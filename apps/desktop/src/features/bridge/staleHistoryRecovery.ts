import { timeframeSeconds } from '../../shared/bridge/timeframes';
import type { Candle } from '../../shared/bridge/types';

/**
 * A live bar this many bar periods after the newest history bar means the
 * history snapshot was served before MT5 finished synchronizing the series.
 * Shorter gaps (a few quiet bars) are normal market behavior and never refresh.
 */
const STALE_HISTORY_GAP_BARS = 3;
const MS_PER_SECOND = 1000;

/** Backoff before each refresh; its length also bounds the attempts per stale episode. */
export const STALE_HISTORY_REFRESH_DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const;

export function isDetachedFromHistory(newestHistoryBar: Candle, liveBar: Candle, timeframe: string): boolean {
  return (
    liveBar.timeMs - newestHistoryBar.timeMs > STALE_HISTORY_GAP_BARS * timeframeSeconds(timeframe) * MS_PER_SECOND
  );
}

/**
 * Bounded retry state for re-requesting the latest history. While a refresh is
 * scheduled or in flight the detached live bars are withheld so the chart never
 * stretches its price scale between stale history and the live price; once the
 * attempts are used up they are rendered as-is rather than hidden forever.
 */
export function createStaleHistoryRecovery(requestRefresh: () => void) {
  let attempts = 0;
  let refreshing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return {
    /** Returns true when the detached live bar must be withheld until the refresh lands. */
    holdDetachedBar(): boolean {
      if (refreshing) {
        return true;
      }
      if (attempts >= STALE_HISTORY_REFRESH_DELAYS_MS.length) {
        return false;
      }
      refreshing = true;
      timer = setTimeout(() => {
        timer = undefined;
        requestRefresh();
      }, STALE_HISTORY_REFRESH_DELAYS_MS[attempts]);
      attempts += 1;
      return true;
    },
    isRefreshing: () => refreshing,
    /** The refresh answered or failed; a still-detached bar may schedule the next attempt. */
    settleRefresh() {
      clearTimer();
      refreshing = false;
    },
    /** A live bar continues the history, so the episode is over. */
    markAttached() {
      attempts = 0;
    },
    /** Selection or session changed: forget the episode and cancel any scheduled refresh. */
    reset() {
      clearTimer();
      refreshing = false;
      attempts = 0;
    },
  };
}
