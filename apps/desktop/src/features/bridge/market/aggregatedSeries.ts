/**
 * The aggregated candles one shown interval draws, grouped from its native base timeframe's bars.
 *
 * A window starts mid-block: the base candles before it are missing, so its oldest block is held
 * back until an older page completes it, exactly as the tick read holds its oldest ticks. The newest
 * block is the forming one, rebuilt from its base candles, so a live base candle of its own time is
 * folded in once and never counted twice.
 */
import type { AggregatedInterval } from '../../../shared/bridge/chartIntervalModel';
import type { Candle } from '../../../shared/bridge/types';
import { aggregatedBlockStartMs, aggregateCandles, foldBaseCandle } from '../../chart/engine/bars/aggregatedBars';

export class AggregatedSeries {
  private readonly interval: AggregatedInterval;
  /** The aggregated candles the chart draws, oldest first. */
  private drawn: readonly Candle[] = [];
  /** The base candles of the forming block, which a live base candle extends. */
  private formingBase: readonly Candle[] = [];
  /** The base candles of the oldest block, held back while the base candles before the window are missing. */
  private heldOldestBase: readonly Candle[] = [];

  constructor(interval: AggregatedInterval) {
    this.interval = interval;
  }

  /** The aggregated candles of a fresh `base` window, oldest first; a partial oldest block stays undrawn. */
  window(base: readonly Candle[]): Candle[] {
    this.drawn = this.withoutPartialOldest(base);
    // A window whose bars all fall in one block has no earlier block to hide it behind: it is the
    // forming block, and holding it back would draw nothing at all.
    if (this.drawn.length === 0 && this.heldOldestBase.length > 0) {
      this.drawn = aggregateCandles(this.heldOldestBase, this.interval);
      this.heldOldestBase = [];
    }
    const forming = this.drawn.at(-1);
    this.formingBase = forming === undefined ? [] : baseOfBlock(base, forming.timeMs, this.interval);
    return [...this.drawn];
  }

  /**
   * The aggregated candles of an older `base` page, to prepend: the block held back before is
   * completed first, and the page's own oldest block is held back in its turn.
   */
  olderPage(base: readonly Candle[]): Candle[] {
    const older = this.olderThanDrawn(base);
    if (older.length === 0) {
      return [];
    }
    const prepended = this.withoutPartialOldest([...older, ...this.heldOldestBase]);
    this.drawn = [...prepended, ...this.drawn];
    return prepended;
  }

  /** The aggregated candle to draw after one live `baseCandle`, or undefined while nothing is drawn. */
  live(baseCandle: Candle): Candle | undefined {
    const folded = foldBaseCandle(this.drawn, baseCandle, this.interval, this.formingBase);
    this.drawn = folded.candles;
    this.formingBase = folded.baseInBlock;
    return folded.candles.at(-1);
  }

  /** Forgets every block, so the series starts over with the next window. */
  reset(): void {
    this.drawn = [];
    this.formingBase = [];
    this.heldOldestBase = [];
  }

  /**
   * The aggregated candles of `base`, minus its oldest block while that block began mid-block and
   * its base candles are still missing; that block's base candles are kept for the older page.
   */
  private withoutPartialOldest(base: readonly Candle[]): Candle[] {
    const aggregated = aggregateCandles(base, this.interval);
    const oldest = aggregated[0];
    if (oldest === undefined || beginsAtBlockStart(base, this.interval)) {
      this.heldOldestBase = [];
      return aggregated;
    }
    this.heldOldestBase = baseOfBlock(base, oldest.timeMs, this.interval);
    return aggregated.slice(1);
  }

  /** The base candles of `base` older than the oldest aggregated candle drawn, which they cannot change. */
  private olderThanDrawn(base: readonly Candle[]): Candle[] {
    const oldestDrawn = this.drawn.at(0);
    if (oldestDrawn === undefined) {
      return [...base];
    }
    return base.filter((baseCandle) => baseCandle.timeMs < oldestDrawn.timeMs);
  }
}

/** Whether the oldest base candle of `base` opens its grid block, so no base candle of that block is missing. */
function beginsAtBlockStart(base: readonly Candle[], interval: AggregatedInterval): boolean {
  const oldest = base[0];
  return oldest !== undefined && aggregatedBlockStartMs(interval, oldest.timeMs) === oldest.timeMs;
}

/** The base candles of `base` that fall in the block opening at `blockStartMs`. */
function baseOfBlock(base: readonly Candle[], blockStartMs: number, interval: AggregatedInterval): Candle[] {
  return base.filter((baseCandle) => aggregatedBlockStartMs(interval, baseCandle.timeMs) === blockStartMs);
}
