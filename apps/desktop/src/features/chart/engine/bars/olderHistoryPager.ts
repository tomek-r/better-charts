import type { Candle } from '../../../../shared/bridge/types';

/** What the pager reads from and writes to the chart; each member is a live accessor. */
export interface OlderHistoryHost {
  isDestroyed(): boolean;
  /** The pane shows empty space before the oldest bar. */
  isBeforeHistory(): boolean;
  /** Open time of the oldest cached bar in epoch seconds; undefined while there are no bars. */
  oldestBarTimeSeconds(): number | undefined;
  visibleRange(): { from: number; to: number } | null;
  /** Prepends the page to the bar cache and answers how many bars were added. */
  prependBars(candles: readonly Candle[]): number;
  /** Shifts the pane by the bars added so the visible bars do not move. */
  anchorAfterPrepend(previous: { from: number; to: number } | null, added: number): void;
  refreshOverlays(): void;
}

/**
 * Decides when the chart asks for a page of older bars and takes the page in. Exhaustion is latched
 * here because it is a property of the loaded history, not of the request in flight; a new window is
 * a new history and `resumePaging` clears the latch.
 */
export class OlderHistoryPager {
  /**
   * Set by the session hook: request a page of bars strictly older than this
   * epoch-millisecond boundary. The hook owns the request; the chart only
   * decides that the user revealed a gap worth filling.
   */
  onNeeded?: (beforeMs: number) => void;
  // Set once the broker's page came back short, or a page held nothing older than the cache.
  private exhausted = false;

  constructor(private readonly host: OlderHistoryHost) {}

  /** Asks for a page once the pane shows empty space before the oldest bar. */
  requestIfGapRevealed(): void {
    if (this.host.isBeforeHistory()) {
      this.prefetch();
    }
  }

  /**
   * Asks for one older page. The scroll path gates it on a revealed gap; the
   * idle prefetch calls it directly. Both share the exhaustion latch and the
   * callback's in-flight guard, so they can never double-request.
   */
  prefetch(): void {
    if (this.host.isDestroyed() || this.exhausted) {
      return;
    }
    const oldestTime = this.host.oldestBarTimeSeconds();
    if (oldestTime !== undefined) {
      this.onNeeded?.(oldestTime * 1000);
    }
  }

  /**
   * Prepends a page of older bars and re-anchors the pane so the visible bars do
   * not move. `complete` is the broker's own end-of-history signal.
   */
  append(candles: readonly Candle[], complete: boolean): void {
    if (this.host.isDestroyed()) {
      return;
    }
    const previous = this.host.visibleRange();
    const added = this.host.prependBars(candles);
    if (added > 0) {
      this.host.anchorAfterPrepend(previous, added);
      this.host.refreshOverlays();
    }
    // A short page ends this history, and so does a page that held nothing
    // older — which is also how a peer that ignored the anchor answers.
    if (!complete || added === 0) {
      this.exhausted = true;
    }
  }

  /** A replaced window is a new history: paging may resume where the last series had reached its end. */
  resumePaging(): void {
    this.exhausted = false;
  }
}
