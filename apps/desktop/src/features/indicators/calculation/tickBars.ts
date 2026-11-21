import type { IndicatorTick } from '../../../shared/bridge/types';
import type { RenderBar } from '../../chart/engine/bars/renderBar';

const MILLISECONDS_PER_SECOND = 1000;

/** One tick as a bar can use it: when it arrived, and the price it carries. */
interface PricedTick {
  readonly timeMs: number;
  readonly price: number;
}

/** The bars a read's ticks build, and how many of them have all their ticks. */
export interface TickBarSeries {
  /** One bar per group of ticks, oldest first; the last one may still be waiting for ticks. */
  readonly bars: readonly RenderBar[];
  /** For every bar, the epoch milliseconds its last tick arrived: the instant the bar ended. */
  readonly endsMs: readonly number[];
  /** The bars that hold every tick they group; the forming last one is not among them. */
  readonly closedCount: number;
}

/** The tick as a price, or null when neither its bid nor its last price reads as one. */
function tickPrice(tick: IndicatorTick): number | null {
  const bid = Number(tick.bid);
  if (Number.isFinite(bid) && bid > 0) {
    return bid;
  }
  // An exchange feed quotes no bid: its trades carry the price on the last price instead.
  const last = Number(tick.last);
  return Number.isFinite(last) && last > 0 ? last : null;
}

/** The ticks a bar can be built from, in the order the wire delivered them. */
function pricedTicks(ticks: readonly IndicatorTick[]): readonly PricedTick[] {
  const priced: PricedTick[] = [];
  for (const tick of ticks) {
    const price = tickPrice(tick);
    if (price !== null) {
      priced.push({ timeMs: tick.timeMs, price });
    }
  }
  return priced;
}

/** The bar one group of ticks forms: opened on its first tick's second, closed on its last price. */
function tickBarOf(group: readonly PricedTick[]): RenderBar {
  const prices = group.map((tick) => tick.price);
  return {
    time: Math.floor(group[0].timeMs / MILLISECONDS_PER_SECOND),
    open: prices[0],
    high: Math.max(...prices),
    low: Math.min(...prices),
    close: prices[prices.length - 1],
    volume: group.length,
  };
}

/**
 * The N-tick bars `ticks` build: every group of `ticksPerBar` ticks is one bar of their open, highest, lowest and
 * last prices, with the ticks it groups as its volume. Any ticks left over form the last bar, which is still
 * taking ticks, so it is not counted as closed.
 */
export function buildTickBars(ticks: readonly IndicatorTick[], ticksPerBar: number): TickBarSeries {
  if (ticksPerBar < 1) {
    return { bars: [], endsMs: [], closedCount: 0 };
  }
  const priced = pricedTicks(ticks);
  const bars: RenderBar[] = [];
  const endsMs: number[] = [];
  for (let start = 0; start < priced.length; start += ticksPerBar) {
    const group = priced.slice(start, start + ticksPerBar);
    bars.push(tickBarOf(group));
    endsMs.push(group[group.length - 1].timeMs);
  }
  return { bars, endsMs, closedCount: Math.floor(priced.length / ticksPerBar) };
}
