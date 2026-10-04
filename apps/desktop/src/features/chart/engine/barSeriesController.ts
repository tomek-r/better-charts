import type { ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '../../../shared/bridge/types';
import { toRenderBar, type RenderBar } from './mt5DataAdapter';
import { DEFAULT_TIMEFRAME, timeframeSeconds } from '../../../shared/bridge/timeframes';
import { palette } from '../../../shared/theme/palette';

/**
 * Owns the renderable bar cache and the two series it feeds, so every mutation
 * funnels through one place; `bars` is read-only for everyone else.
 *
 * `replace` applies the timeframe only once the history has been accepted. A
 * rejected history therefore leaves both the bars and the interval untouched,
 * instead of pairing the new interval with the old bars.
 */
export class BarSeriesController {
  private cache: RenderBar[] = [];
  private interval = timeframeSeconds(DEFAULT_TIMEFRAME);
  private priceDigits = 2;

  constructor(
    private readonly candles: ISeriesApi<'Candlestick'>,
    private readonly volume: ISeriesApi<'Histogram'>,
  ) {}

  get bars(): readonly RenderBar[] {
    return this.cache;
  }

  get intervalSeconds(): number {
    return this.interval;
  }

  lastBar(): RenderBar | undefined {
    return this.cache[this.cache.length - 1];
  }

  /** Replaces the whole history. Returns false when the input was rejected. */
  replace(candles: readonly Candle[], timeframe: string = DEFAULT_TIMEFRAME): boolean {
    const next = candles.map(toRenderBar);
    if (next.some((bar) => bar === null)) {
      return false;
    }
    const bars = next as RenderBar[];
    if (bars.some((bar, index) => index > 0 && bar.time <= bars[index - 1].time)) {
      return false;
    }
    this.interval = timeframeSeconds(timeframe);
    this.cache = bars;
    this.candles.setData(bars.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })));
    this.volume.setData(bars.map((bar) => this.volumeBar(bar)));
    return true;
  }

  /**
   * Prepends older bars ahead of the cached window and returns how many were
   * added. LWC 5 has no prepend API, so both series are rewritten; the caller
   * must re-anchor the visible range, because every existing bar's logical index
   * moved by the number of bars added.
   *
   * Returns 0 when the input holds nothing strictly older than the cache. That
   * is the end of history, and also what a peer that ignored the pagination
   * anchor looks like, so the caller stops paging either way.
   */
  prepend(candles: readonly Candle[]): number {
    const oldest = this.cache[0];
    if (!oldest) {
      return 0;
    }
    const older: RenderBar[] = [];
    for (const candle of candles) {
      const bar = toRenderBar(candle);
      if (bar === null || bar.time >= oldest.time) {
        return 0;
      }
      if (older.length > 0 && bar.time <= older[older.length - 1].time) {
        return 0;
      }
      older.push(bar);
    }
    if (older.length === 0) {
      return 0;
    }
    const bars = [...older, ...this.cache];
    this.cache = bars;
    this.candles.setData(bars.map((bar) => ({ ...bar, time: bar.time as UTCTimestamp })));
    this.volume.setData(bars.map((bar) => this.volumeBar(bar)));
    return older.length;
  }

  /**
   * Writes one candle, appending or replacing the last bar, and returns whether
   * it appended. Callers must reject a bar older than lastBar() themselves: this
   * funnel deliberately does not re-check staleness, so an older bar would
   * overwrite the newest one.
   */
  apply(bar: RenderBar): boolean {
    const appended = bar.time > (this.lastBar()?.time ?? -Infinity);
    if (appended) {
      this.cache.push(bar);
    } else {
      this.cache[this.cache.length - 1] = bar;
    }
    this.candles.update({ ...bar, time: bar.time as UTCTimestamp });
    this.volume.update(this.volumeBar(bar));
    return appended;
  }

  /** Applies a price precision. Returns whether it changed. */
  setPrecision(digits: number): boolean {
    if (digits === this.priceDigits) {
      return false;
    }
    this.priceDigits = digits;
    this.candles.applyOptions({ priceFormat: { type: 'price', precision: digits, minMove: 10 ** -digits } });
    return true;
  }

  private volumeBar(bar: RenderBar) {
    return {
      time: bar.time as UTCTimestamp,
      value: bar.volume,
      color: bar.close >= bar.open ? palette.upWash : palette.sellWash,
    };
  }
}
