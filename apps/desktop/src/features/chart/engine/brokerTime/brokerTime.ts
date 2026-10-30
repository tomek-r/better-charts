import type { BridgeState } from '../../../../shared/bridge/types';

const MS_PER_MINUTE = 60_000;

/** A broker tick timestamp for one symbol. */
export interface BrokerQuote {
  symbol: string;
  timeMs: number;
}

/** Broker time for one symbol, reconstructed from its last live tick. */
export interface BrokerTimeReading {
  /** Symbol whose feed carried the anchor tick. */
  symbol: string;
  /** Broker time now: the tick timestamp plus monotonic elapsed time. */
  nowMs: number;
  /** Age of the newest accepted tick. */
  ageMs: number;
}

/** The tick broker time is counted on from, with when it arrived. */
interface StoredQuote {
  symbol: string;
  timeMs: number;
  /** `performance.now()` at arrival, so elapsed time never depends on the desktop clock. */
  receivedAt: number;
  /** Whether this tick is new enough to trust as a live broker clock. */
  live: boolean;
}

function hasUsableTimeMs(quote: BrokerQuote): boolean {
  return Number.isFinite(quote.timeMs) && quote.timeMs > 0;
}

/**
 * Broker time for the chart, from the last live tick plus monotonic elapsed
 * time. MT5 candle and tick timestamps share broker time, which can differ from
 * desktop UTC by hours, so the desktop clock is never used here.
 */
export class BrokerTime {
  private connected = false;
  private connectionIdentity = '';
  private quote?: StoredQuote;

  /** A dropped connection or a new session invalidates the anchor it was counted on. */
  setConnection(state: BridgeState, identity: string): void {
    if (state !== 'connected' || identity !== this.connectionIdentity) {
      this.clear();
    }
    this.connected = state === 'connected';
    this.connectionIdentity = identity;
  }

  /** Newest tick for a symbol; only a newer timestamp for the same symbol makes broker time live. */
  acceptQuote(quote: BrokerQuote): void {
    // A tick seen while disconnected may be arbitrarily old, so the clock
    // restarts without an anchor; the quote is stored, but not as a live one.
    if (!this.connected) {
      this.clear();
    }
    if (!hasUsableTimeMs(quote)) {
      this.clear();
      return;
    }
    // Repeated cached quotes must not restart the clock. Older ticks cannot
    // extend a candle that has already expired.
    if (this.quote?.symbol === quote.symbol && quote.timeMs <= this.quote.timeMs) {
      return;
    }
    // The initial snapshot may contain a closed market's cached last tick.
    // Only a newer tick for this symbol establishes a live broker clock.
    const live = this.quote?.symbol === quote.symbol;
    this.quote = { symbol: quote.symbol, timeMs: quote.timeMs, receivedAt: performance.now(), live };
  }

  clear(): void {
    this.quote = undefined;
  }

  /** Broker time now, or null until a live tick anchors it. */
  read(): BrokerTimeReading | null {
    const quote = this.quote;
    if (!quote?.live) {
      return null;
    }
    const ageMs = Math.max(0, performance.now() - quote.receivedAt);
    return { symbol: quote.symbol, nowMs: quote.timeMs + ageMs, ageMs };
  }

  /** Broker time as UTC now, or null while no live tick makes broker time known. */
  utcNowMs(brokerUtcOffsetMinutes: number): number | null {
    const reading = this.read();
    if (!reading) {
      return null;
    }
    return reading.nowMs - brokerUtcOffsetMinutes * MS_PER_MINUTE;
  }
}
