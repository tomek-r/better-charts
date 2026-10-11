import type { ProfileResult } from '../../../shared/bridge/types';
import type { ChartToolHost } from '../../chart/engine/toolContract';
import type { ExpectedFixedRangeProfile, FixedRangeProfileState } from './overlay';
import type { FixedRangeProfileRange } from './range';

const LIVE_PROFILE_REFRESH_MS = 2000;
const LIVE_PROFILE_PENDING_MAX_MS = 30_000;
const PROFILE_ROWS = 128;

/**
 * The request side of the profile: it asks the market-data port for the ticks
 * behind a committed range, keeps an open range fresh and drops every result that
 * does not belong to the request still awaited. `expected` is the stale guard: every
 * path that abandons a request clears it, and a new request replaces it.
 */
export class FixedRangeProfileLoader {
  private expected: ExpectedFixedRangeProfile | undefined;
  private lastSentAt = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshRange: FixedRangeProfileRange | undefined;
  private readonly unsubscribe: Array<() => void>;

  constructor(
    private readonly host: ChartToolHost,
    private readonly state: FixedRangeProfileState,
    private readonly committedRange: () => FixedRangeProfileRange | null,
  ) {
    const port = host.marketDataPort;
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
  }

  /** The range was deleted: abandon the request and stop the backend work behind it. */
  cancelRequest(): void {
    this.abandonPendingRequest();
    this.host.marketDataPort.cancelTickProfile();
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
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
      this.expected = { symbol, fromMs, endMs: requestEnd, sentAt, settled: false };
    }
    this.state.range = { fromMs, toMs: nothingToRequest ? range.endMs : requestEnd };
    if (!options.keepProfile) {
      this.state.profile = undefined;
    }
    this.host.requestRepaint();
    if (!nothingToRequest) {
      this.host.marketDataPort.requestTickProfile({ symbol, fromMs, endMs: requestEnd, rows: PROFILE_ROWS });
    }
  }

  // Trailing throttle: a range being refreshed changes on every tick, so refreshes coalesce into one request per
  // interval. Always deferred so symbol-change effects run first. The range the chart reported last is remembered;
  // at fire time the chain ends unless the chart still holds that very range (its final refresh arrives after a bar passed the range end), so a deleted or re-placed range is dropped.
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
      this.host.requestRepaint();
    }
  }
}
