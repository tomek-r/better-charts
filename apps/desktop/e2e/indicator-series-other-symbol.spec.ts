import { expect, test } from '@playwright/test';
import { SERIES_ROUTE } from '../src/features/bridge/market/indicatorSeriesTransport';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import type {
  IndicatorSeriesAnswer,
  IndicatorSeriesQuery,
  IndicatorSeriesSource,
} from '../src/features/chart/engine/indicators/indicatorSeriesSource';
import { IndicatorSeriesRead } from '../src/features/indicators/calculation/indicatorSeriesRead';
import { acquireSeriesRead, type SharedSeriesRead } from '../src/features/indicators/calculation/seriesReadCache';
import type { SeriesReadPlan } from '../src/features/indicators/calculation/seriesPages';
import type { Candle } from '../src/shared/bridge/types';

/**
 * A series read of another symbol: the query names the symbol, the shared cache keeps that read apart from the
 * chart's own, and the candles of that symbol are asked for once per closed bar of their timeframe, never on a
 * tick.
 */

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_MINUTE = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
/** Ten minutes past nine UTC, on a minute boundary, so every minute bar of these cases opens there. */
const FIRST_CANDLE_MS = Date.UTC(2024, 0, 2, 9, 10);
const CHART_SYMBOL = 'EURUSD';
const OTHER_SYMBOL = 'GBPUSD';
const TIMEFRAME = 'M1';
/** The candles a closed bar is asked for: the one that just closed, and the one forming after it. */
const CLOSED_BAR_CANDLES = 2;

/** The minute the newest candle read opens in, and the one after it, in seconds as a bar time is. */
const HELD_MINUTE_SECONDS = (FIRST_CANDLE_MS + MILLISECONDS_PER_MINUTE) / MILLISECONDS_PER_SECOND;
const NEXT_MINUTE_SECONDS = HELD_MINUTE_SECONDS + SECONDS_PER_MINUTE;

/** A bridge candle at `timeMs`, quoting `close` on every price and carrying one tick and one real lot. */
function quotedCandle(timeMs: number, close: number): Candle {
  const quote = close.toFixed(2);
  return { timeMs, open: quote, high: quote, low: quote, close: quote, tickVolume: 1, spread: 1, realVolume: 1 };
}

/** The two candles a read of the other symbol holds: the two minutes that open at `FIRST_CANDLE_MS`. */
const HELD_CANDLES: readonly Candle[] = [
  quotedCandle(FIRST_CANDLE_MS, 10),
  quotedCandle(FIRST_CANDLE_MS + MILLISECONDS_PER_MINUTE, 20),
];
const HELD_PAGE: IndicatorSeriesAnswer = { kind: 'page', beforeMs: null, complete: true, candles: HELD_CANDLES };
const PLAN: SeriesReadPlan = { kind: 'newest', timeframe: TIMEFRAME, pages: [CLOSED_BAR_CANDLES] };

/** One chart bar, priced well above every candle read, so a bar built from it would stand out. */
const CHART_BARS: readonly RenderBar[] = [
  { time: HELD_MINUTE_SECONDS, open: 900, high: 900, low: 900, close: 900, volume: 1 },
];

/** What a stubbed source saw: the queries a read sent, and the answers it hands the reads it holds. */
interface StubSource {
  readonly source: IndicatorSeriesSource;
  readonly sent: IndicatorSeriesQuery[];
  answerAll(answer: IndicatorSeriesAnswer): void;
}

function stubSource(): StubSource {
  const sent: IndicatorSeriesQuery[] = [];
  const listenersByKey = new Map<string, (answer: IndicatorSeriesAnswer) => void>();
  const source: IndicatorSeriesSource = {
    request: (query) => {
      sent.push(query);
    },
    subscribe: (key, listener) => {
      listenersByKey.set(key, listener);
      return () => {
        listenersByKey.delete(key);
      };
    },
  };
  return {
    source,
    sent,
    answerAll: (answer) => {
      for (const listener of [...listenersByKey.values()]) {
        listener(answer);
      }
    },
  };
}

test.describe('sending the symbol a series read names', () => {
  const QUERY: IndicatorSeriesQuery = { key: 'calculation-1', timeframe: TIMEFRAME, bars: 2, beforeMs: null };

  test('a query that names a symbol is put on the wire for that symbol, whatever the chart shows', () => {
    const namedQuery: IndicatorSeriesQuery = { ...QUERY, symbol: OTHER_SYMBOL };

    expect(SERIES_ROUTE.namedSymbol?.(namedQuery)).toBe(OTHER_SYMBOL);
    expect(SERIES_ROUTE.wireArgs(namedQuery, CHART_SYMBOL)).toMatchObject({
      symbol: OTHER_SYMBOL,
      timeframe: TIMEFRAME,
      bars: 2,
      beforeMs: null,
    });
  });

  test('a query that names no symbol is put on the wire for the chart symbol', () => {
    expect(SERIES_ROUTE.namedSymbol?.(QUERY)).toBeUndefined();
    expect(SERIES_ROUTE.wireArgs(QUERY, CHART_SYMBOL)).toMatchObject({ symbol: CHART_SYMBOL });
  });
});

test('a read of another symbol names it on every query it sends', () => {
  const host = stubSource();
  const read = new IndicatorSeriesRead(host.source, () => undefined, OTHER_SYMBOL);

  read.start(PLAN);
  host.answerAll(HELD_PAGE);
  read.followOtherSymbolClose(HELD_MINUTE_SECONDS);
  read.followOtherSymbolClose(NEXT_MINUTE_SECONDS);

  expect(host.sent).toHaveLength(2);
  expect(host.sent.every((query) => query.symbol === OTHER_SYMBOL)).toBe(true);
});

test.describe('keeping another symbol out of the chart read', () => {
  test('the chart read and another symbol read of one timeframe are two reads and two requests', () => {
    const host = stubSource();

    const chartRead = acquireSeriesRead(host.source, TIMEFRAME, PLAN, () => undefined);
    const otherRead = acquireSeriesRead(host.source, TIMEFRAME, PLAN, () => undefined, OTHER_SYMBOL);

    expect(otherRead).not.toBe(chartRead);
    expect(host.sent.map((query) => [query.symbol, query.timeframe])).toEqual([
      [undefined, TIMEFRAME],
      [OTHER_SYMBOL, TIMEFRAME],
    ]);
  });

  test('two indicators reading one other symbol on one timeframe share one read and one request', () => {
    const host = stubSource();

    const first = acquireSeriesRead(host.source, TIMEFRAME, PLAN, () => undefined, OTHER_SYMBOL);
    const second = acquireSeriesRead(host.source, TIMEFRAME, PLAN, () => undefined, OTHER_SYMBOL);
    const chartRead = acquireSeriesRead(host.source, TIMEFRAME, PLAN, () => undefined);

    expect(second).toBe(first);
    expect(chartRead).not.toBe(first);
    expect(host.sent.map((query) => query.symbol)).toEqual([OTHER_SYMBOL, undefined]);
  });
});

test.describe('keeping the candles of another symbol current', () => {
  /** The shared read of the other symbol, started on `PLAN` and holding the two candles read. */
  function startedOtherRead(host: StubSource): SharedSeriesRead {
    const shared = acquireSeriesRead(host.source, TIMEFRAME, PLAN, () => undefined, OTHER_SYMBOL);
    host.answerAll(HELD_PAGE);
    return shared;
  }

  test('ticks inside the bar it already read ask for nothing, and the bar after it asks once', () => {
    const host = stubSource();
    const read = startedOtherRead(host);
    const sentAfterStart = host.sent.length;

    read.followOtherSymbolClose(HELD_MINUTE_SECONDS);
    read.followOtherSymbolClose(HELD_MINUTE_SECONDS);
    expect(host.sent).toHaveLength(sentAfterStart);

    read.followOtherSymbolClose(NEXT_MINUTE_SECONDS);
    read.followOtherSymbolClose(NEXT_MINUTE_SECONDS);
    expect(host.sent).toHaveLength(sentAfterStart + 1);
    expect(host.sent.at(-1)).toMatchObject({
      symbol: OTHER_SYMBOL,
      timeframe: TIMEFRAME,
      bars: CLOSED_BAR_CANDLES,
      beforeMs: null,
    });
  });

  test('the chart bars never rebuild the candles of another symbol', () => {
    const host = stubSource();
    const read = startedOtherRead(host);
    const sentAfterStart = host.sent.length;

    read.followHigherBars(CHART_BARS);
    read.followLowerBars(CHART_BARS, CHART_BARS[0]);

    expect(host.sent).toHaveLength(sentAfterStart);
    expect(read.bars.map((bar) => bar.close)).toEqual([10, 20]);
  });
});
