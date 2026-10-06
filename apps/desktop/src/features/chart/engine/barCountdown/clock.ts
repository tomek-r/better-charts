import { timeframeBarOffset, timeframeBarTime } from '../../../../shared/bridge/timeframes';
import type { BrokerQuote } from './types';

/**
 * Land the wake-up just past a second boundary. Timers fire at or after their
 * delay and `remaining` is float, so an exact boundary can still read as the
 * previous second and burn a wake-up re-arming itself.
 */
const BOUNDARY_GUARD_MS = 20;

/**
 * How long the countdown may run past the newest bar's close without a new
 * tick. MT5 confirms a new bar with its first tick, so a live feed covers this
 * within milliseconds; a quiet or closed feed must not keep a countdown on
 * screen for a bar that may never have opened.
 */
const ROLLOVER_GRACE_MS = 5_000;

interface BrokerClockReading {
  /** Broker time now: last quote timestamp plus monotonic elapsed time. */
  nowMs: number;
  /** Time left in the bar being counted down; never zero. */
  remainingMs: number;
  /** True while counting a bar the broker has not confirmed with a tick yet. */
  rolling: boolean;
  /** Age of the newest accepted tick. */
  ageMs: number;
}

/**
 * Broker time for one symbol, reconstructed from the last tick and monotonic
 * elapsed time. MT5 candle and tick timestamps share broker time, which can
 * differ from desktop UTC by hours, so the desktop clock is never used.
 */
export class BrokerClock {
  private quote?: { symbol: string; timeMs: number; receivedAt: number; live: boolean };

  acceptQuote(quote?: BrokerQuote): void {
    if (!quote || !Number.isFinite(quote.timeMs) || quote.timeMs <= 0) {
      this.quote = undefined;
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

  text(symbol: string, barTime: number | undefined, timeframe: string): string {
    const reading = this.read(symbol, barTime, timeframe);
    if (!reading) {
      return '';
    }
    const seconds = Math.ceil(reading.remainingMs / 1000);
    const pad = (value: number) => value.toString().padStart(2, '0');
    const minutes = pad(Math.floor((seconds % 3600) / 60));
    const tail = `${minutes}:${pad(seconds % 60)}`;
    return seconds >= 3600 ? `${pad(Math.floor(seconds / 3600))}:${tail}` : tail;
  }

  /**
   * Milliseconds until `text()` next changes, or null while it would stay
   * empty. The label flips on whole seconds of broker time, and a rolling
   * countdown may also expire, so the caller wakes at the earliest of those and
   * then asks again from the clock it reads at that moment. A repeating
   * interval carries its own scheduling error and slips out of phase with the
   * broker within minutes, which shows up as a countdown that skips or lags a
   * second.
   */
  nextTickDelayMs(symbol: string, barTime: number | undefined, timeframe: string): number | null {
    const reading = this.read(symbol, barTime, timeframe);
    if (!reading) {
      return null;
    }
    const delays = [1000 - (reading.nowMs % 1000), reading.remainingMs];
    if (reading.rolling) {
      delays.push(ROLLOVER_GRACE_MS - reading.ageMs);
    }
    return Math.min(...delays) + BOUNDARY_GUARD_MS;
  }

  private read(symbol: string, barTime: number | undefined, timeframe: string): BrokerClockReading | null {
    const quote = this.quote;
    if (!quote?.live || quote.symbol !== symbol || barTime === undefined) {
      return null;
    }
    const ageMs = Math.max(0, performance.now() - quote.receivedAt);
    const nowMs = quote.timeMs + ageMs;
    const startMs = barTime * 1000;
    if (nowMs < startMs) {
      return null;
    }
    // Past the newest bar's close the countdown continues into the bar the
    // broker has not confirmed yet, so the tag rolls over instead of blinking
    // off at every bar close; the grace keeps a stale feed from counting down a
    // bar that never opened.
    const rolled = Math.floor(timeframeBarOffset(timeframe, barTime, nowMs / 1000));
    if (rolled > 0 && ageMs > ROLLOVER_GRACE_MS) {
      return null;
    }
    return {
      nowMs,
      remainingMs: timeframeBarTime(timeframe, barTime, rolled + 1) * 1000 - nowMs,
      rolling: rolled > 0,
      ageMs,
    };
  }
}
