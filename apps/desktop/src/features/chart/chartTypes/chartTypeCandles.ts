import type { Candle } from '../../../shared/bridge/types';
import { barTimeAfter } from '../engine/bars/tickBarTimeline';
import type { ChartTypeBar } from './chartTypeCommands';

const MILLISECONDS_PER_SECOND = 1000;

/** The volume a brick or a line carries, as the whole count the chart draws. */
function volumeOf(volume: string): number {
  const parsed = Number(volume);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

/** One bar the command drew, as the candle the chart draws: the prices stay the broker's decimal text. */
function candleOf(bar: ChartTypeBar, timeSeconds: number): Candle {
  return {
    timeMs: timeSeconds * MILLISECONDS_PER_SECOND,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    tickVolume: volumeOf(bar.volume),
    spread: 0,
    realVolume: 0,
  };
}

/**
 * The bars a chart type drew, as the candles the chart draws.
 *
 * A brick or a line forms on a price move rather than at a broker time, so its time only has to order it: its
 * own second, and at least one second after the bar before it, because the library refuses equal times.
 */
export function chartTypeCandles(bars: readonly ChartTypeBar[]): Candle[] {
  const candles: Candle[] = [];
  let previousTime: number | undefined;
  for (const bar of bars) {
    const time = barTimeAfter(previousTime, Math.floor(bar.timeMs / MILLISECONDS_PER_SECOND));
    previousTime = time;
    candles.push(candleOf(bar, time));
  }
  return candles;
}
