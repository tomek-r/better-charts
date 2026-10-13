import { timeframeSeconds } from '../../shared/bridge/timeframes';
import type { Candle } from '../../shared/bridge/types';

/**
 * A live bar this many bar periods after the newest history bar means the
 * history snapshot was served before MT5 finished synchronizing the series.
 * Shorter gaps (a few quiet bars) are normal market behavior and never refresh.
 */
const STALE_HISTORY_GAP_BARS = 3;
const MS_PER_SECOND = 1000;

/** Pause before every history refresh while the live bar stays detached. */
export const STALE_HISTORY_REFRESH_INTERVAL_MS = 2000;
/** Quick syncs finish before this and never flash a loader. */
export const STALE_HISTORY_LOADER_DELAY_MS = 4000;

export function isDetachedFromHistory(newestHistoryBar: Candle, liveBar: Candle, timeframe: string): boolean {
  return (
    liveBar.timeMs - newestHistoryBar.timeMs > STALE_HISTORY_GAP_BARS * timeframeSeconds(timeframe) * MS_PER_SECOND
  );
}

/**
 * Recovery from history that MT5 served before it synchronized the series. An
 * episode starts at the first detached live bar and lasts until history catches
 * up with it (or the selection or session ends). During the episode detached
 * live bars are withheld, so the chart never stretches its price scale between
 * stale history and the live price, and the latest history is re-requested at a
 * fixed interval. The loader shows only once the episode outlasts a short delay.
 */
export function createStaleHistoryRecovery(requestRefresh: () => void, setLoaderVisible: (visible: boolean) => void) {
  let withheldBar: Candle | undefined;
  // True from scheduling a refresh until its answer or failure; `retryTimer` is set only before the request leaves.
  let refreshing = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let loaderTimer: ReturnType<typeof setTimeout> | undefined;
  let loaderVisible = false;

  const showLoader = (visible: boolean) => {
    if (loaderVisible !== visible) {
      loaderVisible = visible;
      setLoaderVisible(visible);
    }
  };

  const cancelPendingRefresh = () => {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
      refreshing = false;
    }
  };

  const scheduleRefresh = () => {
    cancelPendingRefresh();
    refreshing = true;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      requestRefresh();
    }, STALE_HISTORY_REFRESH_INTERVAL_MS);
  };

  const endEpisode = () => {
    withheldBar = undefined;
    cancelPendingRefresh();
    clearTimeout(loaderTimer);
    loaderTimer = undefined;
    showLoader(false);
  };

  return {
    /** Withholds a detached live bar and, for the first one of an episode, starts the refresh cycle. */
    withholdDetachedBar(liveBar: Candle) {
      const episodeActive = withheldBar !== undefined;
      withheldBar = liveBar;
      if (episodeActive) {
        return;
      }
      scheduleRefresh();
      loaderTimer = setTimeout(() => {
        loaderTimer = undefined;
        showLoader(true);
      }, STALE_HISTORY_LOADER_DELAY_MS);
    },
    isRefreshing: () => refreshing,
    /** A history snapshot landed: the episode ends if it caught up with the withheld bar, otherwise it refreshes again. */
    refreshAnswered(newestHistoryBar: Candle | undefined, timeframe: string) {
      cancelPendingRefresh();
      refreshing = false;
      if (withheldBar === undefined) {
        return;
      }
      if (newestHistoryBar && !isDetachedFromHistory(newestHistoryBar, withheldBar, timeframe)) {
        endEpisode();
        return;
      }
      scheduleRefresh();
    },
    /** The refresh request failed; the episode keeps its interval. */
    refreshFailed() {
      refreshing = false;
      if (withheldBar !== undefined) {
        scheduleRefresh();
      }
    },
    /** A live bar continues the history, so the episode is over. */
    markAttached() {
      if (withheldBar !== undefined) {
        endEpisode();
      }
    },
    /** Selection or session changed: forget the episode and cancel any scheduled refresh. */
    reset() {
      endEpisode();
      refreshing = false;
    },
  };
}
