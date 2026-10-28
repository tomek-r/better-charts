import type { ProfileResult } from '../../../../shared/bridge/types';
import type { MarketDataPort, ProfileRequestParams } from '../../../bridge/marketDataPort';
import type { ChartToolHost } from '../../../chart/engine/tools/toolContract';
import type { ExpectedFixedRangeProfile, FixedRangeProfileState } from '../overlay';
import type { FixedRangeProfileRange } from '../range';

/** The histogram settings of a profile whose owner supplies none: 128 rows and a 70% value area. */
export const DEFAULT_PROFILE_REQUEST_PARAMS: ProfileRequestParams = {
  rowsLayout: { kind: 'rows', count: 128 },
  valueAreaPercent: 70,
};
const LIVE_PROFILE_REFRESH_MS = 2000;
/**
 * Safety net only. Every awaited request ends with a result, a correlated error (EA page read timeout 120 s), a
 * cancellation or a rejected invoke, and a session change or disconnect resets the tool, so a refresh must never
 * replace a request still loading: the backend would drop the load in flight and restart a load that already takes
 * 30-90 s on a busy feed. The cutoff only recovers from a lost terminal event, so it is well beyond a legitimate load.
 */
const LIVE_PROFILE_PENDING_MAX_MS = 300_000;
/** How long the awaited request may stay unanswered before the chart shows a loading spinner. */
export const SLOW_PROFILE_SPINNER_DELAY_MS = 6000;
/** Repaint period of the visible spinner (about 30 fps); no repaints are scheduled while it is hidden. */
const SPINNER_REPAINT_MS = 33;

/**
 * The request side of the profile: it asks the market-data port for the ticks
 * behind a committed range, keeps an open range fresh and drops every result that
 * does not belong to the request still awaited. `expected` is the stale guard: every
 * path that abandons a request clears it, and a new request replaces it.
 *
 * `port` is the port of the one drawing this requester belongs to: it may be the bridge
 * itself or the turn-taking queue every drawing shares, which is what keeps the backend
 * to one load at a time.
 *
 * `requestParams` is how the owner supplies the histogram settings (rows layout, value area percent); it is read on
 * every request, so a setting changed between two requests reaches the next one.
 */
export class FixedRangeProfileRequester {
  private expected: ExpectedFixedRangeProfile | undefined;
  private lastSentAt = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshRange: FixedRangeProfileRange | undefined;
  /** Counts down the slow-load delay of the awaited request, then drives the spinner's repaints. */
  private spinnerTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly unsubscribe: Array<() => void>;

  constructor(
    private readonly host: ChartToolHost,
    private readonly port: MarketDataPort,
    private readonly state: FixedRangeProfileState,
    private readonly committedRange: () => FixedRangeProfileRange | null,
    private readonly requestParams: () => ProfileRequestParams = () => DEFAULT_PROFILE_REQUEST_PARAMS,
  ) {
    this.unsubscribe = [
      port.onTickProfile((profile) => this.acceptProfileResult(profile)),
      port.onTickProfileCancelled((event) => {
        if (this.isAwaitedRequest(event)) {
          this.abandonPendingRequest();
        }
      }),
      port.onTickProfileError((event) => {
        if (this.isAwaitedRequest(event)) {
          host.notifyError(event.message);
          this.abandonPendingRequest();
        }
      }),
    ];
  }

  /** Abandons the request in flight: a late result for it is stale from here on. */
  abandonPendingRequest(): void {
    this.expected = undefined;
    this.hideSpinner();
  }

  /**
   * The drawing was hidden: abandon the request in flight and stop refreshing, so nothing reaches
   * the backend until the drawing is shown again.
   */
  suspendRequests(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.refreshRange = undefined;
    this.abandonPendingRequest();
  }

  /** The range was deleted: abandon the request and stop the backend work behind it. */
  cancelRequest(): void {
    this.abandonPendingRequest();
    this.port.cancelTickProfile();
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.hideSpinner();
    for (const release of this.unsubscribe) {
      release();
    }
  }

  requestProfile(range: FixedRangeProfileRange, options: { keepProfile?: boolean } = {}): void {
    const symbol = this.host.currentMarket.symbol();
    if (!symbol) {
      return;
    }
    const { fromMs } = range;
    // Tick and quote times are broker server time. Ticks older than the newest quote are final, but the backend
    // caches a completed raw tick page by its requested end, so a request reaching past the newest tick would be
    // cached as complete and later open-range refreshes would be served that stale page. Historical ranges are unaffected.
    const quote = this.host.currentMarket.quote();
    const newestBarMs = (this.host.barSeries.bars.at(-1)?.time ?? 0) * 1000;
    const quoteMs = quote && quote.symbol === symbol && Number.isFinite(quote.timeMs) ? quote.timeMs : 0;
    const liveEdgeMs = [quoteMs, newestBarMs].find((ms) => ms > 0) ?? range.endMs;
    const requestEnd = Math.min(range.endMs, liveEdgeMs);
    const nothingToRequest = requestEnd <= fromMs;
    if (nothingToRequest) {
      // Invalidate any in-flight result for the previous range so it cannot be painted for this one.
      this.abandonPendingRequest();
    } else {
      const sentAt = Date.now();
      this.lastSentAt = sentAt;
      const previous = this.expected;
      const continuesUnsettledLoad =
        previous !== undefined && !previous.settled && previous.symbol === symbol && previous.fromMs === fromMs;
      this.expected = { symbol, fromMs, endMs: requestEnd, sentAt, settled: false };
      if (!continuesUnsettledLoad) {
        this.startSpinnerCountdown();
      }
    }
    this.state.range = { fromMs, toMs: nothingToRequest ? range.endMs : requestEnd };
    if (!options.keepProfile) {
      this.state.profile = undefined;
    }
    this.host.requestRepaint();
    if (!nothingToRequest) {
      this.port.requestTickProfile({ symbol, fromMs, endMs: requestEnd, ...this.requestParams() });
    }
  }

  /**
   * Safety net after a timeframe switch: a request that never settled (its terminal event was lost or came while
   * the old timeframe's data was swapped) is sent again instead of waited for. A loaded profile is left alone.
   */
  renewUnsettledRequest(range: FixedRangeProfileRange): void {
    if (this.expected?.settled) {
      return;
    }
    this.requestProfile(range, { keepProfile: true });
  }

  // Trailing throttle: a range being refreshed changes on every tick, so refreshes coalesce into one request per
  // interval. Always deferred so symbol-change effects run first. The range the chart reported last is remembered;
  // when it runs the chain ends unless the chart still holds that very range (its final refresh arrives after a bar passed the range end), so a deleted or re-placed range is dropped.
  requestThrottledRefresh(reported: FixedRangeProfileRange): void {
    this.refreshRange = reported;
    if (this.refreshTimer !== undefined) {
      return;
    }
    const scheduleRefresh = (delayMs: number) => {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        const range = this.committedRange();
        const latest = this.refreshRange;
        if (!range || !latest || range.fromMs !== latest.fromMs || range.endMs !== latest.endMs) {
          return;
        }
        const expected = this.expected;
        if (expected && !expected.settled && Date.now() - expected.sentAt < LIVE_PROFILE_PENDING_MAX_MS) {
          scheduleRefresh(LIVE_PROFILE_REFRESH_MS);
          return;
        }
        this.requestProfile(range, { keepProfile: true });
      }, delayMs);
    };
    scheduleRefresh(Math.max(0, this.lastSentAt + LIVE_PROFILE_REFRESH_MS - Date.now()));
  }

  // A request for another range replaces the awaited one, so its countdown starts from zero. A request for the same
  // placed range (the live edge advanced) continues the unsettled load and keeps the original countdown or spinner.
  private startSpinnerCountdown(): void {
    this.hideSpinner();
    this.spinnerTimer = setTimeout(() => {
      if (!this.expected || this.expected.settled) {
        return;
      }
      this.state.loadingIndicator = true;
      this.repaintSpinner();
    }, SLOW_PROFILE_SPINNER_DELAY_MS);
  }

  private repaintSpinner(): void {
    this.host.requestRepaint();
    this.spinnerTimer = setTimeout(() => this.repaintSpinner(), SPINNER_REPAINT_MS);
  }

  /** Stops the countdown and the repaint loop, and repaints once if the spinner was showing. */
  private hideSpinner(): void {
    clearTimeout(this.spinnerTimer);
    this.spinnerTimer = undefined;
    if (this.state.loadingIndicator) {
      this.state.loadingIndicator = false;
      this.host.requestRepaint();
    }
  }

  /** The event belongs to the profile request still awaited. */
  private isAwaitedRequest(payload: { symbol: string; fromMs: number; endMs: number }): boolean {
    const expected = this.expected;
    return (
      expected !== undefined &&
      payload.symbol === expected.symbol &&
      payload.fromMs === expected.fromMs &&
      payload.endMs === expected.endMs
    );
  }

  private acceptProfileResult(profile: ProfileResult): void {
    if (
      this.isAwaitedRequest(profile) &&
      profile.symbol === this.host.currentMarket.symbol() &&
      profile.complete !== undefined
    ) {
      this.state.profile = profile;
      if (this.expected) {
        this.expected.settled = true;
      }
      this.hideSpinner();
      this.host.requestRepaint();
    }
  }
}
