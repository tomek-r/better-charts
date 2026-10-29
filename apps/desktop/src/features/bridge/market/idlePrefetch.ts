/** Longest the prefetch waits for an idle period before running anyway. */
const PREFETCH_IDLE_TIMEOUT_MS = 2000;
/** Stand-in for `requestIdleCallback` where it is missing. */
const PREFETCH_FALLBACK_DELAY_MS = 200;

interface IdlePrefetchOptions {
  /** Whether the snapshot identified by `dataKey` is still the one on screen and nothing is being selected. */
  isStillWanted: (dataKey: string) => boolean;
  prefetch: () => void;
}

/**
 * One idle prefetch per accepted snapshot: it runs after the first view has
 * painted, so the page that fills the history never competes with first
 * render. A newer snapshot, a pending selection change or teardown cancels it.
 */
export function createIdlePrefetch({ isStillWanted, prefetch }: IdlePrefetchOptions) {
  let cancelScheduled: (() => void) | undefined;
  const cancel = () => {
    cancelScheduled?.();
    cancelScheduled = undefined;
  };
  const schedule = (dataKey: string) => {
    cancel();
    let cancelled = false;
    let frame: number | undefined;
    let idle: number | undefined;
    let timer: number | undefined;
    const runPrefetch = () => {
      cancelScheduled = undefined;
      if (cancelled || !isStillWanted(dataKey)) {
        return;
      }
      prefetch();
    };
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (typeof requestIdleCallback === 'function') {
        idle = requestIdleCallback(runPrefetch, { timeout: PREFETCH_IDLE_TIMEOUT_MS });
      } else {
        timer = window.setTimeout(runPrefetch, PREFETCH_FALLBACK_DELAY_MS);
      }
    });
    cancelScheduled = () => {
      cancelled = true;
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
      if (idle !== undefined && typeof cancelIdleCallback === 'function') {
        cancelIdleCallback(idle);
      }
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  };
  return { schedule, cancel };
}
