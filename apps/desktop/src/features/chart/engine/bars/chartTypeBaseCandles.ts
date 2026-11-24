import type { Candle } from '../../../../shared/bridge/types';
import { sameChartTypeParameters, type ChartTypeAppearance } from '../barStyle/chartTypeAppearance';

/** Whether two candles hold the same bar, which decides if an answer moved anything at all. */
export function sameCandle(first: Candle | undefined, second: Candle | undefined): boolean {
  if (first === undefined || second === undefined) {
    return first === second;
  }
  return (
    first.timeMs === second.timeMs &&
    first.open === second.open &&
    first.high === second.high &&
    first.low === second.low &&
    first.close === second.close &&
    first.tickVolume === second.tickVolume
  );
}

/** Whether two windows hold the same bars, so an answer that moved nothing costs no write. */
export function sameCandles(first: readonly Candle[], second: readonly Candle[]): boolean {
  return first.length === second.length && first.every((candle, index) => sameCandle(candle, second[index]));
}

/** Whether only the newest bar an answer drew changed, which the chart writes instead of replacing itself. */
export function onlyNewestChanged(before: readonly Candle[], after: readonly Candle[]): boolean {
  if (before.length === 0 || before.length !== after.length) {
    return false;
  }
  const newest = after.length - 1;
  return (
    !sameCandle(before[newest], after[newest]) &&
    before.every((candle, index) => index === newest || sameCandle(candle, after[index]))
  );
}

/** The candles of a page that really are older than the chart's window, in order. */
export function olderCandles(base: readonly Candle[], page: readonly Candle[]): readonly Candle[] {
  const oldest = base[0];
  if (oldest === undefined) {
    return [];
  }
  const older: Candle[] = [];
  for (const candle of page) {
    const previous = older[older.length - 1];
    if (candle.timeMs >= oldest.timeMs || (previous !== undefined && candle.timeMs <= previous.timeMs)) {
      break;
    }
    older.push(candle);
  }
  return older;
}

/** The base candles with one live candle folded in: appended, replaced, or dropped as older than the newest. */
export function withLiveCandle(base: readonly Candle[], candle: Candle): readonly Candle[] {
  const newest = base[base.length - 1];
  if (newest === undefined) {
    return [candle];
  }
  if (candle.timeMs > newest.timeMs) {
    return [...base, candle];
  }
  if (candle.timeMs === newest.timeMs && !sameCandle(newest, candle)) {
    return [...base.slice(0, -1), candle];
  }
  return base;
}

/** Whether two chart types ask the command for the same bars, so a colour change costs no redraw. */
export function sameChartType(first: ChartTypeAppearance | null, second: ChartTypeAppearance | null): boolean {
  if (first === null || second === null) {
    return first === second;
  }
  return sameChartTypeParameters(first, second);
}
