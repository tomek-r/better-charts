import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RenderBar } from '../src/features/chart/engine/bars/renderBar';
import { readSavedIndicators } from '../src/features/chart/chartSettings/savedIndicators';
import { indicatorSettingsSchema } from '../src/features/chart/engine/indicators/indicatorDisplaySettings';
import type { IndicatorFrame } from '../src/features/chart/engine/indicators/indicatorFrame';
import type {
  IndicatorSeriesAnswer,
  IndicatorSeriesQuery,
} from '../src/features/chart/engine/indicators/indicatorSeriesSource';
import type { SettingValues } from '../src/features/chart/engine/settings/settingInputs';
import { resolveSettingValues } from '../src/features/chart/engine/settings/settingsSchema';
import { CalculationIndicator } from '../src/features/indicators/calculation/calculationIndicator';
import {
  CALCULATION_GROUP,
  CALCULATION_TIMEFRAME_INPUT,
  CALCULATION_TIMEFRAME_TOOLTIP,
  WAIT_FOR_CLOSES_INPUT,
  calculationTimeframeChoices,
} from '../src/features/indicators/calculation/calculationInputs';
import { bucketBars, higherTimeframeBarTime } from '../src/features/indicators/calculation/higherTimeframeBars';
import { projectHigherTimeframeFrame } from '../src/features/indicators/calculation/higherTimeframeFrame';
import { IndicatorSeriesRead } from '../src/features/indicators/calculation/indicatorSeriesRead';
import {
  projectLowerTimeframeFrame,
  shownLowerBars,
  type LowerTimeframeSource,
} from '../src/features/indicators/calculation/lowerTimeframeFrame';
import {
  SERIES_MAX_PAGES,
  SERIES_PAGE_BARS,
  SERIES_WARMUP_BARS,
  chartRangeSeconds,
  seriesCandlesCovering,
  seriesPageSizes,
  seriesReadPlan,
  type SeriesReadPlan,
} from '../src/features/indicators/calculation/seriesPages';
import { withCalculation } from '../src/features/indicators/calculation/withCalculation';
import { CHART_INDICATOR_PLUGINS } from '../src/features/indicators/registry';
import { smaPlugin } from '../src/features/indicators/sma/smaPlugin';
import type { Candle, IndicatorTick } from '../src/shared/bridge/types';
import { timeframeOptions } from '../src/shared/bridge/timeframes';
import { averageOf } from './helpers/averageValues';
import { drawnValues } from './helpers/indicatorFrames';
import { openSmaSettingsFromRow } from './helpers/indicatorObjectTree';
import { attachedIndicators } from './helpers/indicatorsDialog';
import { failOnPageNoise } from './helpers/pageNoise';
import { EURUSD_CHART, latestSavedIndicators, openWithSavedIndicators } from './helpers/savedIndicators';
import {
  STUB_NOW,
  gotoWithStub,
  pushEvent,
  setIndicatorSeriesUnavailable,
  stubInvocations,
  type RecordedHistory,
  type RecordedInvoke,
} from './helpers/tauriStub';

failOnPageNoise();

/**
 * The Calculation section every built-in indicator carries: the timeframe it is calculated on, the wait for
 * that timeframe to close, the bars of another timeframe read from the bridge or grouped from the chart's own,
 * and the values they give projected back onto the chart bars.
 */

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * SECONDS_PER_MINUTE;
const SECONDS_PER_DAY = 24 * SECONDS_PER_HOUR;
const SECONDS_PER_M5 = 5 * SECONDS_PER_MINUTE;
const MILLISECONDS_PER_MINUTE = SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_M5 = SECONDS_PER_M5 * MILLISECONDS_PER_SECOND;
const MILLISECONDS_PER_HOUR = SECONDS_PER_HOUR * MILLISECONDS_PER_SECOND;
/** Nine o'clock UTC, on a minute and a five-minute boundary, so every bucket of these cases starts there. */
const FIRST_BAR_SECONDS = Date.UTC(2023, 10, 14, 9, 0) / MILLISECONDS_PER_SECOND;

/**
 * The stub chart's own timeframe, and the long words the drop-down rows these cases read are written with; the
 * legend keeps the short code of the timeframe an indicator is calculated on.
 */
const CHART_TIMEFRAME = 'M5';
const CHART_CHOICE_LABEL = '5 minutes';
const HIGHER_CHOICE = 'M15';
const HIGHER_CHOICE_LABEL = '15 minutes';
const HIGHER_LEGEND_LABEL = '15m';
/** A timeframe whose candles these cases record, so the values can only come from the bridge. */
const RECORDED_HIGHER_TIMEFRAME = 'H1';
const RECORDED_LOWER_TIMEFRAME = 'M1';

/** The saved moving average the page cases start from, short enough to average two bars. */
const SAVED_LENGTH = 2;
const SAVED_NAME = 'SMA 2 close';

/** The inputs the Calculation section adds to every built-in indicator: the timeframe and the wait switch. */
const CALCULATION_INPUT_COUNT = 2;

/** How far a tick moves the forming bar's close in the live-update case. */
const TICK_OFFSET = 10;

/** The stub's fixed clock sits on a five-minute boundary, so the chart's newest M5 bar opens there. */
const NEWEST_M5_OPEN_MS = Math.floor(STUB_NOW / MILLISECONDS_PER_M5) * MILLISECONDS_PER_M5;
/** The hour that clock sits in: where the higher-timeframe cases' forming H1 bucket starts. */
const NEWEST_HOUR_OPEN_MS = Math.floor(STUB_NOW / MILLISECONDS_PER_HOUR) * MILLISECONDS_PER_HOUR;
/** The last M5 bar of that hour: the chart bar a case opens to close the hour it forms. */
const LAST_M5_OF_HOUR_MS = NEWEST_HOUR_OPEN_MS + MILLISECONDS_PER_HOUR - MILLISECONDS_PER_M5;
/** The M5 bars the recorded chart of a lower-timeframe case holds. */
const CHART_BAR_COUNT = 5;
/** The first M5 bar the higher-timeframe cases record: it opens the oldest hour their H1 series covers. */
const FIRST_M5_OF_HOUR_SERIES_MS = NEWEST_HOUR_OPEN_MS - 3 * MILLISECONDS_PER_HOUR;

/** How many live updates of one chart bar a live-tick case pushes. */
const LIVE_TICKS = 3;
/** The price the live ticks of a case move the forming bar to, well above every recorded close. */
const LIVE_TICK_CLOSE = 200;
/** The close of the bar a case opens after the newest one, well above every recorded close. */
const NEW_BAR_CLOSE = 400;

/** The tick choice the tick-mode case calculates with, and the ticks one of its bars groups. */
const TICK_CHOICE = 'tick10';
/** The ticks the tick-mode case records: one a second, ending a second before the newest M5 bar closes. */
const TICK_FEED_SIZE = 30;
/** How many indicators a shared-read case saves on one timeframe. */
const SHARED_READERS = 2;

/** The SMA as the registry registers it: its own inputs plus the Calculation section. */
const REGISTERED_SMA = withCalculation(smaPlugin);

/** An M1 bar `offsetMinutes` after the first one, priced and weighted as the case gives it. */
function minuteBar(
  offsetMinutes: number,
  prices: { open: number; high: number; low: number; close: number },
  volume: number,
): RenderBar {
  return { time: FIRST_BAR_SECONDS + offsetMinutes * SECONDS_PER_MINUTE, ...prices, volume };
}

/** An M5 bar `offsetBars` after the first one, closing at `close` and flat all around it. */
function m5Bar(offsetBars: number, close: number): RenderBar {
  const time = FIRST_BAR_SECONDS + offsetBars * SECONDS_PER_M5;
  return { time, open: close, high: close, low: close, close, volume: 1 };
}

/** The SMA of the closes of a series the indicator read from the host, one value per candle. */
function seriesSma(candles: readonly Candle[]): (number | null)[] {
  return averageOf(
    candles.map((candle) => Number(candle.close)),
    SAVED_LENGTH,
  );
}

/** The SMA of the chart's own closes, the values a calculation on another timeframe must never reproduce. */
function chartSma(bars: readonly RenderBar[]): number[] {
  const closes = bars.map((bar) => bar.close);
  return averageOf(closes, SAVED_LENGTH).filter((value): value is number => value !== null);
}

/** The values a higher-timeframe frame draws onto `bucketOf`: each bucket shows its predecessor's value. */
function waitedBucketValues(bucketOf: readonly number[], bucketSma: readonly (number | null)[]): number[] {
  return bucketOf
    .map((bucketIndex) => bucketSma[bucketIndex - 1] ?? null)
    .filter((value): value is number => value !== null);
}

/** The values the recorded M1 series draws, read off the M1 bars the lower-timeframe cases show. */
function minuteValues(minuteSeries: readonly Candle[], shownIndexes: readonly number[]): number[] {
  const minuteSma = seriesSma(minuteSeries);
  return shownIndexes.map((index) => minuteSma[index]).filter((value): value is number => value !== null);
}

/** The M1 bars the loaded case shows: the last closed one inside each M5 bar, the forming one left out. */
const SHOWN_MINUTE_BARS = [3, 8, 13, 17];

/** The settings the registered SMA resolves for the calculation these cases ask of it. */
function calculationSettings(stored: SettingValues): SettingValues {
  return resolveSettingValues(indicatorSettingsSchema(REGISTERED_SMA), stored);
}

test.describe('the Calculation section', () => {
  test('every built-in indicator the registry lists carries it after its own inputs', () => {
    for (const plugin of CHART_INDICATOR_PLUGINS) {
      const sectionInputs = plugin.inputs?.slice(-CALCULATION_INPUT_COUNT);

      expect(sectionInputs?.map((input) => input.id)).toEqual([CALCULATION_TIMEFRAME_INPUT, WAIT_FOR_CLOSES_INPUT]);
      expect(sectionInputs?.map((input) => input.group)).toEqual([CALCULATION_GROUP, CALCULATION_GROUP]);
    }
  });

  test('Chart comes first, then the four tick options, then every MT5 timeframe read the long way', () => {
    const choices = calculationTimeframeChoices();

    expect(choices.slice(0, 5).map((choice) => choice.title)).toEqual([
      'Chart',
      '1 tick',
      '10 ticks',
      '100 ticks',
      '1000 ticks',
    ]);
    expect(choices.slice(5).map((choice) => choice.value)).toEqual(timeframeOptions.map(({ wire }) => wire));
    expect(choices.slice(5, 9).map((choice) => choice.title)).toEqual([
      '1 minute',
      '2 minutes',
      '3 minutes',
      '4 minutes',
    ]);
  });

  test('every choice can be picked, the four tick options included', () => {
    const choices = calculationTimeframeChoices();

    expect(choices.filter((choice) => choice.disabledReason !== undefined)).toEqual([]);
    for (const { wire } of timeframeOptions) {
      expect(choices.some((choice) => choice.value === wire)).toBe(true);
    }
  });
});

test.describe('grouping the chart bars into a higher timeframe', () => {
  const SEVEN_MINUTES: readonly RenderBar[] = [
    minuteBar(0, { open: 10, high: 12, low: 9, close: 11 }, 5),
    minuteBar(1, { open: 11, high: 15, low: 10, close: 14 }, 6),
    minuteBar(2, { open: 14, high: 14, low: 8, close: 9 }, 7),
    minuteBar(3, { open: 9, high: 13, low: 9, close: 12 }, 8),
    minuteBar(4, { open: 12, high: 16, low: 11, close: 13 }, 9),
    minuteBar(5, { open: 13, high: 18, low: 12, close: 17 }, 10),
    minuteBar(6, { open: 17, high: 19, low: 16, close: 18 }, 11),
  ];

  test('seven M1 bars become one whole and one forming M5 bar of their own prices and volume', () => {
    const { bars, bucketOf } = bucketBars(SEVEN_MINUTES, 'M5');

    expect(bucketOf).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(bars).toEqual([
      { time: FIRST_BAR_SECONDS, open: 10, high: 16, low: 8, close: 13, volume: 35 },
      { time: FIRST_BAR_SECONDS + SECONDS_PER_M5, open: 13, high: 19, low: 12, close: 18, volume: 21 },
    ]);
  });

  test('a higher-timeframe bar starts on its grid, the weekly and monthly ones on their calendar boundary', () => {
    const threeDaysLater = FIRST_BAR_SECONDS + 3 * SECONDS_PER_DAY;

    expect(higherTimeframeBarTime('M5', FIRST_BAR_SECONDS + 7 * SECONDS_PER_MINUTE)).toBe(
      FIRST_BAR_SECONDS + SECONDS_PER_M5,
    );
    expect(higherTimeframeBarTime('W1', threeDaysLater)).toBe(Date.UTC(2023, 10, 13) / MILLISECONDS_PER_SECOND);
    expect(higherTimeframeBarTime('MN1', threeDaysLater)).toBe(Date.UTC(2023, 10, 1) / MILLISECONDS_PER_SECOND);
  });
});

test.describe('projecting a higher-timeframe frame onto the chart bars', () => {
  /** Six M1 bars: five fill the first M5 bar and the sixth opens the one still forming. */
  const SIX_MINUTES: readonly RenderBar[] = [5, 6, 7, 8, 9, 10].map((close, index) =>
    minuteBar(index, { open: close, high: close, low: close, close }, 1),
  );
  const FIVE_MINUTE_BARS = bucketBars(SIX_MINUTES, 'M5');
  const FIVE_MINUTE_FRAME: IndicatorFrame = {
    plots: [{ title: 'value', style: 'line', color: '#26a69a', lineWidth: 1 }],
    bars: [
      { timeMs: FIVE_MINUTE_BARS.bars[0].time * MILLISECONDS_PER_SECOND, confirmed: true, values: [10] },
      { timeMs: FIVE_MINUTE_BARS.bars[1].time * MILLISECONDS_PER_SECOND, confirmed: false, values: [20] },
    ],
  };

  /** The two-bucket frame written onto the six chart bars, read the way `source` says. */
  function projectedValues(source: 'its-bucket' | 'last-closed-bucket'): (number | null)[] {
    const frame = projectHigherTimeframeFrame(
      FIVE_MINUTE_FRAME,
      { chartBars: SIX_MINUTES, bucketOf: FIVE_MINUTE_BARS.bucketOf },
      source,
    );
    return frame.map((bar) => bar.values[0]);
  }

  test('every chart bar takes the value of the bucket it falls in, the forming bucket included', () => {
    expect(projectedValues('its-bucket')).toEqual([10, 10, 10, 10, 10, 20]);
  });

  test('a chart bar keeps the last closed bucket, so the step follows the close and not the forming bar', () => {
    expect(projectedValues('last-closed-bucket')).toEqual([null, null, null, null, null, 10]);
  });

  test('a projected bar is the chart bar, forming only where the chart still draws it', () => {
    const frame = projectHigherTimeframeFrame(
      FIVE_MINUTE_FRAME,
      { chartBars: SIX_MINUTES, bucketOf: FIVE_MINUTE_BARS.bucketOf },
      'its-bucket',
    );

    expect(frame.map((bar) => bar.timeMs)).toEqual(SIX_MINUTES.map((bar) => bar.time * MILLISECONDS_PER_SECOND));
    expect(frame.map((bar) => bar.confirmed)).toEqual([true, true, true, true, true, false]);
  });
});

test.describe('projecting a lower-timeframe frame onto the chart bars', () => {
  /** Two M5 chart bars and the seven M1 bars that opened inside them; the newest M1 bar is still forming. */
  const CHART_BARS: readonly RenderBar[] = [m5Bar(0, 100), m5Bar(1, 200)];
  const LOWER_BARS: readonly RenderBar[] = [10, 20, 30, 40, 50, 60, 70].map((close, index) =>
    minuteBar(index, { open: close, high: close, low: close, close }, 1),
  );
  const LOWER_FRAME: IndicatorFrame = {
    plots: [{ title: 'value', style: 'line', color: '#26a69a', lineWidth: 1 }],
    bars: LOWER_BARS.map((bar, index) => ({
      timeMs: bar.time * MILLISECONDS_PER_SECOND,
      confirmed: index !== LOWER_BARS.length - 1,
      values: [index + 1],
    })),
  };

  /** The values these chart bars show when each reads its bar the way `source` says. */
  function projectedValues(chartBars: readonly RenderBar[], source: LowerTimeframeSource): (number | null)[] {
    const shownOf = shownLowerBars(LOWER_BARS, chartBars, SECONDS_PER_M5, source);
    return projectLowerTimeframeFrame(LOWER_FRAME, chartBars, shownOf).map((bar) => bar.values[0]);
  }

  test('a chart bar takes the value of the last lower bar inside it, the forming one included', () => {
    expect(projectedValues(CHART_BARS, 'last-in-chart-bar')).toEqual([5, 7]);
  });

  test('waiting for lower closes leaves the forming lower bar out, so each bar keeps the closed one', () => {
    expect(projectedValues(CHART_BARS, 'last-closed-in-chart-bar')).toEqual([5, 6]);
  });

  test('a chart bar no lower bar opened inside has no value at all', () => {
    expect(projectedValues([...CHART_BARS, m5Bar(2, 300)], 'last-in-chart-bar')).toEqual([5, 7, null]);
    expect(projectedValues([...CHART_BARS, m5Bar(2, 300)], 'last-closed-in-chart-bar')).toEqual([5, 6, null]);
  });

  test('a projected bar is the chart bar, forming only where the chart still draws it', () => {
    const chartBars = [...CHART_BARS, m5Bar(2, 300)];
    const shownOf = shownLowerBars(LOWER_BARS, chartBars, SECONDS_PER_M5, 'last-in-chart-bar');
    const frame = projectLowerTimeframeFrame(LOWER_FRAME, chartBars, shownOf);

    expect(frame.map((bar) => bar.timeMs)).toEqual(chartBars.map((bar) => bar.time * MILLISECONDS_PER_SECOND));
    expect(frame.map((bar) => bar.confirmed)).toEqual([true, true, false]);
  });
});

test.describe('planning the pages of a series read', () => {
  /** Three hours of M5 chart bars, whose range a read has to cover. */
  const THREE_HOURS_OF_M5: readonly RenderBar[] = Array.from({ length: 36 }, (_, index) => m5Bar(index, 100 + index));
  const THREE_HOURS_SECONDS = 3 * SECONDS_PER_HOUR;

  test('a read asks for the chart range and the warm-up in candles of its timeframe', () => {
    expect(seriesCandlesCovering(THREE_HOURS_SECONDS, 'H1')).toBe(SERIES_WARMUP_BARS + 4);
    expect(seriesCandlesCovering(THREE_HOURS_SECONDS, 'M1')).toBe(SERIES_WARMUP_BARS + 181);
  });

  test('the chart range spans its oldest to its newest bar, the one still forming included', () => {
    expect(chartRangeSeconds(THREE_HOURS_OF_M5, CHART_TIMEFRAME)).toBe(THREE_HOURS_SECONDS);
  });

  test('a higher timeframe is one whole page, and a lower one walks back to the oldest chart bar', () => {
    expect(seriesReadPlan(THREE_HOURS_OF_M5, CHART_TIMEFRAME, 'H1')).toEqual({
      kind: 'newest',
      timeframe: 'H1',
      pages: [SERIES_WARMUP_BARS + 4],
    });
    expect(seriesReadPlan(THREE_HOURS_OF_M5, CHART_TIMEFRAME, 'M1')).toEqual({
      kind: 'paged',
      timeframe: 'M1',
      pages: [SERIES_WARMUP_BARS + 181],
      oldestMs: THREE_HOURS_OF_M5[0].time * MILLISECONDS_PER_SECOND,
    });
  });

  test('a range no page can hold is cut at the page bound, the last page carrying the rest', () => {
    expect(seriesPageSizes(2400)).toEqual([SERIES_PAGE_BARS, SERIES_PAGE_BARS, 400]);
    expect(seriesPageSizes(SERIES_PAGE_BARS * (SERIES_MAX_PAGES + 2))).toEqual(
      Array.from({ length: SERIES_MAX_PAGES }, () => SERIES_PAGE_BARS),
    );
  });
});

/** A source that records every query and answers each read through the listener it subscribed. */
class AnsweringSeriesSource {
  readonly queries: IndicatorSeriesQuery[] = [];
  private readonly listeners = new Map<string, (answer: IndicatorSeriesAnswer) => void>();

  request(query: IndicatorSeriesQuery): void {
    this.queries.push(query);
  }

  subscribe(key: string, listener: (answer: IndicatorSeriesAnswer) => void): () => void {
    this.listeners.set(key, listener);
    return () => this.listeners.delete(key);
  }

  answer(answer: IndicatorSeriesAnswer): void {
    for (const listener of [...this.listeners.values()]) {
      listener(answer);
    }
  }
}

/** A stub candle of `timeMs` closing at `close`, flat around it so the chart draws it. */
function candleAt(timeMs: number, close: number): Candle {
  const price = close.toFixed(4);
  return { timeMs, open: price, high: price, low: price, close: price, tickVolume: 1, spread: 1, realVolume: 1 };
}

/** `count` candles of `intervalMs` ending at `newestOpenMs`, closing one point higher than the one before. */
function risingSeries(count: number, intervalMs: number, newestOpenMs: number, firstClose: number): Candle[] {
  return Array.from({ length: count }, (_, index) =>
    candleAt(newestOpenMs - (count - 1 - index) * intervalMs, firstClose + index),
  );
}

/** One page of `candles`, answered for the anchor `beforeMs` the read asked it with. */
function pageAnswer(candles: readonly Candle[], beforeMs: number | null): IndicatorSeriesAnswer {
  return { kind: 'page', beforeMs, complete: false, candles };
}

test.describe('reading another timeframe through the host', () => {
  const OLDEST_CHART_MS = FIRST_BAR_SECONDS * MILLISECONDS_PER_SECOND;
  const SECOND_MINUTE_MS = OLDEST_CHART_MS + MILLISECONDS_PER_MINUTE;
  const THIRD_MINUTE_MS = OLDEST_CHART_MS + 2 * MILLISECONDS_PER_MINUTE;
  const FOURTH_MINUTE_MS = OLDEST_CHART_MS + 3 * MILLISECONDS_PER_MINUTE;
  const PLAN: SeriesReadPlan = { kind: 'paged', timeframe: 'M1', pages: [2, 2], oldestMs: OLDEST_CHART_MS };
  const NEWEST_PAGE = [candleAt(THIRD_MINUTE_MS, 30), candleAt(FOURTH_MINUTE_MS, 40)];
  const OLDER_PAGE = [candleAt(OLDEST_CHART_MS, 10), candleAt(SECOND_MINUTE_MS, 20)];

  test('a read asks for its pages newest first, walking back until a page reaches the oldest chart bar', () => {
    const source = new AnsweringSeriesSource();
    const read = new IndicatorSeriesRead(source, () => undefined);

    read.start(PLAN);
    expect(source.queries.map((query) => [query.bars, query.beforeMs])).toEqual([[2, null]]);

    source.answer(pageAnswer(NEWEST_PAGE, null));
    expect(source.queries.map((query) => [query.bars, query.beforeMs])).toEqual([
      [2, null],
      [2, NEWEST_PAGE[0].timeMs],
    ]);

    source.answer(pageAnswer(OLDER_PAGE, NEWEST_PAGE[0].timeMs));
    expect(source.queries).toHaveLength(2);
    expect(read.bars.map((bar) => bar.close)).toEqual([10, 20, 30, 40]);
  });

  test('a read the host cannot answer keeps the candles it holds and asks for nothing more', () => {
    const source = new AnsweringSeriesSource();
    const read = new IndicatorSeriesRead(source, () => undefined);
    read.start(PLAN);
    source.answer(pageAnswer(NEWEST_PAGE, null));

    source.answer({ kind: 'unavailable' });

    expect(source.queries).toHaveLength(2);
    expect(read.bars.map((bar) => bar.close)).toEqual([30, 40]);
  });
});

test.describe('an SMA calculated on a higher timeframe', () => {
  const BARS_PER_HOUR = SECONDS_PER_HOUR / SECONDS_PER_M5;
  const HOURS = 3;
  /** Three whole hours of M5 bars, whose closes rise by one every bar. */
  const THREE_HOURS_OF_M5: readonly RenderBar[] = Array.from({ length: HOURS * BARS_PER_HOUR }, (_, index) =>
    m5Bar(index, 100 + index),
  );
  const HOURLY_BARS = bucketBars(THREE_HOURS_OF_M5, 'H1');
  const HOURLY_SMA = averageOf(
    HOURLY_BARS.bars.map((bar) => bar.close),
    SAVED_LENGTH,
  );

  /** The H1 SMA settings these cases calculate with, under the wait switch they ask for. */
  function smaSettings(waitForCloses: boolean): SettingValues {
    const stored = { length: SAVED_LENGTH, calculationTimeframe: 'H1', [WAIT_FOR_CLOSES_INPUT]: waitForCloses };
    return calculationSettings(stored);
  }

  test('its values are the SMA of the grouped H1 bars, written onto the M5 bars that fall in them', () => {
    const frame = new CalculationIndicator(smaPlugin.indicatorClass).load(
      THREE_HOURS_OF_M5,
      smaSettings(false),
      CHART_TIMEFRAME,
    );

    expect(frame.bars.map((bar) => bar.timeMs)).toEqual(
      THREE_HOURS_OF_M5.map((bar) => bar.time * MILLISECONDS_PER_SECOND),
    );
    expect(frame.bars.map((bar) => bar.values[0])).toEqual(
      HOURLY_BARS.bucketOf.map((bucketIndex) => HOURLY_SMA[bucketIndex]),
    );
  });

  test('waiting for the hourly close holds every chart bar on the hour before it', () => {
    const frame = new CalculationIndicator(smaPlugin.indicatorClass).load(
      THREE_HOURS_OF_M5,
      smaSettings(true),
      CHART_TIMEFRAME,
    );

    expect(frame.bars.map((bar) => bar.values[0])).toEqual(
      HOURLY_BARS.bucketOf.map((bucketIndex) => HOURLY_SMA[bucketIndex - 1] ?? null),
    );
  });

  test('a tick rewrites the M5 bars of the forming hour and no older one', () => {
    const formingBar = THREE_HOURS_OF_M5[THREE_HOURS_OF_M5.length - 1];
    const tickBar = { ...formingBar, close: formingBar.close + TICK_OFFSET };
    const indicator = new CalculationIndicator(smaPlugin.indicatorClass);
    indicator.load(THREE_HOURS_OF_M5, smaSettings(false), CHART_TIMEFRAME);

    const updated = indicator.update(tickBar, smaSettings(false));
    const fresh = new CalculationIndicator(smaPlugin.indicatorClass).load(
      [...THREE_HOURS_OF_M5.slice(0, -1), tickBar],
      smaSettings(false),
      CHART_TIMEFRAME,
    );
    const formingHourIndex = HOURLY_BARS.bucketOf.indexOf(HOURLY_BARS.bars.length - 1);

    expect(updated.bars).toEqual(fresh.bars.slice(formingHourIndex));
  });
});

/** Opens the settings dialog of the saved moving average, seeding it on the chart before it loads. */
async function openSmaSettings(page: Page): Promise<Locator> {
  const saved = { instanceId: 'sma-1', definitionId: 'sma', settings: { length: SAVED_LENGTH } };
  await openWithSavedIndicators(page, [saved]);
  return openSmaSettingsFromRow(page);
}

/** The Calculation section of an indicator's Inputs tab. */
function calculationGroup(dialog: Locator): Locator {
  return dialog.getByRole('group', { name: 'Calculation', exact: true });
}

/** The bars the chart holds right now, oldest first. */
async function drawnBars(page: Page): Promise<readonly RenderBar[]> {
  return page.evaluate(() => window.__chartTest!.data());
}

/** The series requests the app sent for the chart's symbol, oldest first. */
async function seriesRequests(page: Page): Promise<RecordedInvoke[]> {
  const invocations = await stubInvocations(page);
  return invocations.filter((entry) => entry.cmd === 'request_indicator_series' && entry.args.symbol === 'EURUSD');
}

/** Waits for the chart to hold `count` bars, so a case reads a settled series. */
async function waitForChartBars(page: Page, count: number): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__chartTest?.data().length ?? 0)).toBe(count);
}

/** Pushes `LIVE_TICKS` live updates of the bar opening at `barOpenMs`, each moving its close and volume up. */
async function pushLiveTicks(page: Page, barOpenMs: number): Promise<void> {
  for (let tick = 1; tick <= LIVE_TICKS; tick += 1) {
    const candle: Candle = {
      ...candleAt(barOpenMs, LIVE_TICK_CLOSE + tick),
      tickVolume: tick,
      realVolume: tick,
    };
    await pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe: CHART_TIMEFRAME, candle });
  }
}

/** Pushes the chart bar that opens at `barOpenMs`, closing the one the chart was drawing. */
async function pushNewChartBar(page: Page, barOpenMs: number): Promise<void> {
  await pushEvent(page, 'bar-update', {
    symbol: 'EURUSD',
    timeframe: CHART_TIMEFRAME,
    candle: candleAt(barOpenMs, NEW_BAR_CLOSE),
  });
}

/** Pushes live ticks into the chart's newest bar and asserts the host is asked for no series again. */
async function expectNoSeriesRequestOnLiveTicks(page: Page, barOpenMs: number): Promise<void> {
  const requestCountBefore = (await seriesRequests(page)).length;
  await pushLiveTicks(page, barOpenMs);
  expect((await seriesRequests(page)).length).toBe(requestCountBefore);
}

/** The value the first plot carries on the chart's newest drawn bar. */
async function lastDrawnValue(page: Page): Promise<number | undefined> {
  return (await drawnValues(page)).at(-1);
}

/** Opens the app on `series` (the chart's own first) with `readers` saved SMAs calculating on `timeframe`. */
async function openWithSeriesCalculation(
  page: Page,
  series: RecordedHistory[],
  timeframe: string,
  readers = 1,
): Promise<void> {
  const settings = { length: SAVED_LENGTH, [CALCULATION_TIMEFRAME_INPUT]: timeframe };
  const indicators = Array.from({ length: readers }, (_, index) => ({
    instanceId: `sma-${index + 1}`,
    definitionId: 'sma',
    settings,
  }));
  await gotoWithStub(page, {
    recordedHistory: series,
    chartSettingOverrides: { [EURUSD_CHART]: { indicators } },
  });
  await waitForChartBars(page, series[0].candles.length);
}

/** Opens the app on five M5 chart bars with the recorded M1 series these lower-timeframe cases read. */
async function openWithRecordedMinutes(page: Page, readers = 1): Promise<Candle[]> {
  const chartCandles = risingSeries(CHART_BAR_COUNT, MILLISECONDS_PER_M5, NEWEST_M5_OPEN_MS, 100);
  const minuteCandles = risingSeries(19, MILLISECONDS_PER_MINUTE, NEWEST_M5_OPEN_MS - MILLISECONDS_PER_MINUTE, 1000);
  await openWithSeriesCalculation(
    page,
    [
      { symbol: 'EURUSD', timeframe: CHART_TIMEFRAME, candles: chartCandles },
      { symbol: 'EURUSD', timeframe: RECORDED_LOWER_TIMEFRAME, candles: minuteCandles },
    ],
    RECORDED_LOWER_TIMEFRAME,
    readers,
  );
  return minuteCandles;
}

/** The recorded M5 bars from `FIRST_M5_OF_HOUR_SERIES_MS` to `newestM5OpenMs`, whole hours on both ends. */
function m5BarsTo(newestM5OpenMs: number): Candle[] {
  const count = (newestM5OpenMs - FIRST_M5_OF_HOUR_SERIES_MS) / MILLISECONDS_PER_M5 + 1;
  return risingSeries(count, MILLISECONDS_PER_M5, newestM5OpenMs, 100);
}

/**
 * Opens the app on M5 bars from the oldest hour of the recorded H1 series to `newestM5OpenMs`, so the chart's
 * first bucket is the series' first candle.
 */
async function openWithRecordedHours(page: Page, newestM5OpenMs = NEWEST_M5_OPEN_MS): Promise<Candle[]> {
  const chartCandles = m5BarsTo(newestM5OpenMs);
  const hourlyCandles = risingSeries(4, MILLISECONDS_PER_HOUR, NEWEST_HOUR_OPEN_MS, 500);
  await openWithSeriesCalculation(
    page,
    [
      { symbol: 'EURUSD', timeframe: CHART_TIMEFRAME, candles: chartCandles },
      { symbol: 'EURUSD', timeframe: RECORDED_HIGHER_TIMEFRAME, candles: hourlyCandles },
    ],
    RECORDED_HIGHER_TIMEFRAME,
  );
  return hourlyCandles;
}

/** A tick of `timeMs` quoting `price` on both sides, as the bridge's tick pages carry it. */
function tickQuote(timeMs: number, price: number): IndicatorTick {
  const quote = price.toFixed(2);
  return { timeMs, bid: quote, ask: quote, last: quote, volume: 1 };
}

/** The ticks the tick-mode case reads: one a second, each a point higher, ending before the newest M5 bar does. */
function ticksBeforeNewestBarEnd(): IndicatorTick[] {
  const rangeEndMs = NEWEST_M5_OPEN_MS + MILLISECONDS_PER_M5;
  return Array.from({ length: TICK_FEED_SIZE }, (_, index) =>
    tickQuote(rangeEndMs - (TICK_FEED_SIZE - index) * MILLISECONDS_PER_SECOND, 100 + index),
  );
}

/** Opens the app on five M5 chart bars with the saved SMA calculating on the ten-tick choice over `ticks`. */
async function openWithRecordedTicks(page: Page, ticks: readonly IndicatorTick[]): Promise<void> {
  const settings = { length: SAVED_LENGTH, [CALCULATION_TIMEFRAME_INPUT]: TICK_CHOICE };
  const chartCandles = risingSeries(CHART_BAR_COUNT, MILLISECONDS_PER_M5, NEWEST_M5_OPEN_MS, 100);
  await gotoWithStub(page, {
    recordedHistory: [{ symbol: 'EURUSD', timeframe: CHART_TIMEFRAME, candles: chartCandles }],
    recordedTicks: [{ symbol: 'EURUSD', ticks: [...ticks] }],
    chartSettingOverrides: {
      [EURUSD_CHART]: { indicators: [{ instanceId: 'sma-1', definitionId: 'sma', settings }] },
    },
  });
  await waitForChartBars(page, CHART_BAR_COUNT);
}

/** The tick reads the app sent for a window ending after `endMs`: the ones a closed chart bar asks for. */
async function tickReadsEndingAfter(page: Page, endMs: number): Promise<RecordedInvoke[]> {
  const invocations = await stubInvocations(page);
  return invocations.filter((entry) => entry.cmd === 'request_indicator_ticks' && Number(entry.args.toMs) > endMs);
}

test('the Inputs tab carries the Calculation section with the Chart timeframe and the wait switch', async ({
  page,
}) => {
  const group = calculationGroup(await openSmaSettings(page));

  await expect(group).toBeVisible();
  await expect(group.getByLabel('Timeframe', { exact: true })).toHaveText('Chart');
  await expect(group.getByRole('checkbox', { name: 'Wait for timeframe closes', exact: true })).toBeChecked();

  await group.getByRole('button', { name: 'Info', exact: true }).hover();
  await expect(page.locator('.drawing-settings-tooltip-bubble')).toHaveText(CALCULATION_TIMEFRAME_TOOLTIP);
});

test('the drop-down offers the tick options and every timeframe pickable', async ({ page }) => {
  const group = calculationGroup(await openSmaSettings(page));
  await group.getByLabel('Timeframe', { exact: true }).click();

  const choices = [
    '1 tick',
    '10 ticks',
    '100 ticks',
    '1000 ticks',
    CHART_CHOICE_LABEL,
    '1 minute',
    HIGHER_CHOICE_LABEL,
  ];
  for (const label of choices) {
    await expect(page.getByRole('option', { name: label, exact: true })).not.toHaveAttribute('aria-disabled', 'true');
  }
});

test('the drop-down names its MT5 timeframes the long way, as the chart interval menu does', async ({ page }) => {
  const group = calculationGroup(await openSmaSettings(page));
  await group.getByLabel('Timeframe', { exact: true }).click();

  const longRows = page.getByRole('option', { name: /^(1 minute|4 hours)$/ }).locator('span:not(.select-check)');
  await expect(longRows).toHaveText(['1 minute', '4 hours']);
});

test('saving a higher timeframe renames the legend and draws the values of the grouped bars', async ({ page }) => {
  const dialog = await openSmaSettings(page);
  await calculationGroup(dialog).getByLabel('Timeframe', { exact: true }).click();
  await page.getByRole('option', { name: HIGHER_CHOICE_LABEL, exact: true }).click();
  await dialog.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => (await attachedIndicators(page))[0]?.settings[CALCULATION_TIMEFRAME_INPUT])
    .toBe(HIGHER_CHOICE);
  const saved = readSavedIndicators(await latestSavedIndicators(page));
  expect(saved?.[0]?.settings[CALCULATION_TIMEFRAME_INPUT]).toBe(HIGHER_CHOICE);

  const legendRows = page.getByLabel('Indicator legend', { exact: true }).locator('.chart-indicator-legend-row');
  await expect(legendRows.first()).toContainText(`${SAVED_NAME} ${HIGHER_LEGEND_LABEL}`);

  const chartBars = await drawnBars(page);
  const grouped = bucketBars(chartBars, HIGHER_CHOICE);
  const groupedSma = averageOf(
    grouped.bars.map((bar) => bar.close),
    SAVED_LENGTH,
  );
  // The wait switch is on, so every chart bar shows the last M15 bar that closed before it. No M15 series is
  // recorded for this case, so the read finds no candles and the grouped bars stand in for them.
  await expect.poll(() => drawnValues(page)).toEqual(waitedBucketValues(grouped.bucketOf, groupedSma));
  expect(await drawnValues(page)).not.toEqual(chartSma(chartBars));
});

test('a lower timeframe is read from the bridge and each chart bar shows the last closed lower bar inside it', async ({
  page,
}) => {
  const minuteSeries = await openWithRecordedMinutes(page);

  // The wait switch is on, so the M1 bar the read holds last — 21:19 — counts as the forming one, and the chart's
  // last bar (21:20) holds no M1 bar at all.
  await expect.poll(() => drawnValues(page)).toEqual(minuteValues(minuteSeries, SHOWN_MINUTE_BARS));

  const [request] = await seriesRequests(page);
  expect(request.args).toMatchObject({ symbol: 'EURUSD', timeframe: RECORDED_LOWER_TIMEFRAME, beforeMs: null });
  expect(Number(request.args.bars)).toBeGreaterThan(minuteSeries.length);
  const chartBars = await drawnBars(page);
  expect(await drawnValues(page)).not.toEqual(chartSma(chartBars));
});

test('a higher timeframe is read from the bridge and its closed bars give the chart bars their values', async ({
  page,
}) => {
  const hourlySeries = await openWithRecordedHours(page);

  const chartBars = await drawnBars(page);
  const buckets = bucketBars(chartBars, RECORDED_HIGHER_TIMEFRAME);
  await expect.poll(() => drawnValues(page)).toEqual(waitedBucketValues(buckets.bucketOf, seriesSma(hourlySeries)));

  const [request] = await seriesRequests(page);
  expect(request.args).toMatchObject({ symbol: 'EURUSD', timeframe: RECORDED_HIGHER_TIMEFRAME, beforeMs: null });
  expect(await drawnValues(page)).not.toEqual(chartSma(chartBars));
});

test('an unavailable series keeps the values already drawn and asks for nothing more', async ({ page }) => {
  const minuteSeries = await openWithRecordedMinutes(page);
  await expect.poll(() => drawnValues(page)).toEqual(minuteValues(minuteSeries, SHOWN_MINUTE_BARS));
  // A live tick starts the lower bar the chart's own bars build, so the close below only moves that one on.
  await pushLiveTicks(page, NEWEST_M5_OPEN_MS);
  const drawnBefore = await drawnValues(page);
  const requestCountBefore = (await seriesRequests(page)).length;
  await setIndicatorSeriesUnavailable(page, true);

  // The forming chart bar closes, so the lower bar inside it closes with it and the indicator asks the bridge
  // for the two newest candles, which it cannot read.
  await pushNewChartBar(page, NEWEST_M5_OPEN_MS + MILLISECONDS_PER_M5);
  await expect.poll(async () => (await seriesRequests(page)).length).toBe(requestCountBefore + 1);
  const requestCountAfterClose = (await seriesRequests(page)).length;

  expect(await drawnValues(page)).toEqual(drawnBefore);
  // The refused answer starts no retry: nothing is asked for the series again on its own.
  expect((await seriesRequests(page)).length).toBe(requestCountAfterClose);
});

test('live ticks inside one lower-timeframe bar ask the bridge for no series again', async ({ page }) => {
  const minuteSeries = await openWithRecordedMinutes(page);
  await expect.poll(() => drawnValues(page)).toEqual(minuteValues(minuteSeries, SHOWN_MINUTE_BARS));

  await expectNoSeriesRequestOnLiveTicks(page, NEWEST_M5_OPEN_MS);
});

test('live ticks inside one higher-timeframe bucket ask the bridge for no series again', async ({ page }) => {
  const hourlySeries = await openWithRecordedHours(page);
  const bucketOf = bucketBars(await drawnBars(page), RECORDED_HIGHER_TIMEFRAME).bucketOf;
  await expect.poll(() => drawnValues(page)).toEqual(waitedBucketValues(bucketOf, seriesSma(hourlySeries)));

  await expectNoSeriesRequestOnLiveTicks(page, NEWEST_M5_OPEN_MS);
});

test('a closed higher bucket sends no request and the chart bars take its value', async ({ page }) => {
  const hourlySeries = await openWithRecordedHours(page, LAST_M5_OF_HOUR_MS);
  const closedBars = await drawnBars(page);
  const buckets = bucketBars(closedBars, RECORDED_HIGHER_TIMEFRAME);
  await expect.poll(() => drawnValues(page)).toEqual(waitedBucketValues(buckets.bucketOf, seriesSma(hourlySeries)));
  const requestCountBefore = (await seriesRequests(page)).length;

  await pushNewChartBar(page, LAST_M5_OF_HOUR_MS + MILLISECONDS_PER_M5);

  // The hour the chart closed is the one its own bars form, so the newest chart bar shows that bucket's value,
  // built from the bridge candle before it and from the bucket the chart's bars just completed.
  const closedHour = buckets.bars[buckets.bars.length - 1];
  const bridgeHourBefore = hourlySeries[hourlySeries.length - 2];
  await expect.poll(() => lastDrawnValue(page)).toBe((Number(bridgeHourBefore.close) + closedHour.close) / 2);
  expect((await seriesRequests(page)).length).toBe(requestCountBefore);
});

test('a closed lower bar asks the bridge once for its two newest candles', async ({ page }) => {
  const minuteSeries = await openWithRecordedMinutes(page);
  await expect.poll(() => drawnValues(page)).toEqual(minuteValues(minuteSeries, SHOWN_MINUTE_BARS));
  const requestCountBefore = (await seriesRequests(page)).length;

  await pushNewChartBar(page, NEWEST_M5_OPEN_MS + MILLISECONDS_PER_M5);

  await expect.poll(async () => (await seriesRequests(page)).length).toBe(requestCountBefore + 1);
  const requests = await seriesRequests(page);
  expect(requests[requests.length - 1].args).toMatchObject({
    symbol: 'EURUSD',
    timeframe: RECORDED_LOWER_TIMEFRAME,
    beforeMs: null,
  });
  expect(Number(requests[requests.length - 1].args.bars)).toBe(2);

  // One request per closed lower bar: the ticks of the bar it just opened ask for nothing.
  await expectNoSeriesRequestOnLiveTicks(page, NEWEST_M5_OPEN_MS + MILLISECONDS_PER_M5);
});

test('two indicators of the same timeframe share one read and send one request', async ({ page }) => {
  // The chart's history is loaded once over the stub's, and each history its read holds is asked for once; a
  // second indicator of that timeframe joins the read the chart already holds instead of asking again.
  const aloneSeries = await openWithRecordedMinutes(page);
  await expect.poll(() => drawnValues(page)).toEqual(minuteValues(aloneSeries, SHOWN_MINUTE_BARS));
  const aloneRequests = (await seriesRequests(page)).length;

  const sharedSeries = await openWithRecordedMinutes(page, SHARED_READERS);
  await expect.poll(() => drawnValues(page)).toEqual(minuteValues(sharedSeries, SHOWN_MINUTE_BARS));
  expect(await seriesRequests(page)).toHaveLength(aloneRequests);
});

test('a closed chart bar asks the ticks read only for the ticks after the newest one held', async ({ page }) => {
  const ticks = ticksBeforeNewestBarEnd();
  await openWithRecordedTicks(page, ticks);
  await expect.poll(() => drawnValues(page)).not.toEqual([]);
  const rangeEndMs = NEWEST_M5_OPEN_MS + MILLISECONDS_PER_M5;

  await pushNewChartBar(page, rangeEndMs);

  await expect.poll(async () => (await tickReadsEndingAfter(page, rangeEndMs)).length).toBe(1);
  const [closedBarRead] = await tickReadsEndingAfter(page, rangeEndMs);
  // The feed's last tick is the newest one held, so the read asks for what arrived after it, up to the range end.
  expect(Number(closedBarRead.args.fromMs)).toBe(ticks[ticks.length - 1].timeMs + 1);
  expect(Number(closedBarRead.args.toMs)).toBe(rangeEndMs + MILLISECONDS_PER_M5);

  // A live tick moves no tick bar, so it asks for nothing either.
  await pushLiveTicks(page, rangeEndMs);
  expect(await tickReadsEndingAfter(page, rangeEndMs)).toHaveLength(1);
});
