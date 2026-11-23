import type { Candle } from '../../../shared/bridge/types';
import { toRenderBar, type RenderBar } from '../../chart/engine/bars/renderBar';
import type {
  IndicatorSeriesAnswer,
  IndicatorSeriesQuery,
  IndicatorSeriesSource,
} from '../../chart/engine/indicators/indicatorSeriesSource';
import { higherTimeframeBarTime, withFormingBucket } from './higherTimeframeBars';
import { LiveKeyedRead } from './liveKeyedRead';
import type { SeriesReadPlan } from './seriesPages';

const MILLISECONDS_PER_SECOND = 1000;
/** The bridge's key charset is `[A-Za-z0-9_:-]`, so a read's key needs no escaping. */
const SERIES_KEY_PREFIX = 'calculation';
/** The candles a closed lower bar asks for: the one built here from the chart's bars, and the one after it. */
const CLOSED_LOWER_BAR_CANDLES = 2;

/** The candles of a page as bars; a candle the chart cannot draw is left out, as a history page does. */
function pageBarsOf(candles: readonly Candle[]): readonly RenderBar[] {
  const bars: RenderBar[] = [];
  for (const candle of candles) {
    const bar = toRenderBar(candle);
    if (bar !== null) {
      bars.push(bar);
    }
  }
  return bars;
}

/** The candles held with the newest page written over the ones it replaces. */
function withNewestPage(bars: readonly RenderBar[], page: readonly RenderBar[]): readonly RenderBar[] {
  return [...bars.filter((bar) => bar.time < page[0].time), ...page];
}

/** The candles held with an older page put in front of the ones it precedes. */
function withOlderPage(bars: readonly RenderBar[], page: readonly RenderBar[]): readonly RenderBar[] {
  const oldestHeld = bars[0]?.time ?? Number.POSITIVE_INFINITY;
  return [...page.filter((bar) => bar.time < oldestHeld), ...bars];
}

/** The lower bar `start` opens, priced at the newest price the chart's bar carries. */
function openingLowerBar(start: number, chartBar: RenderBar, volumeGrowth: number): RenderBar {
  const price = chartBar.close;
  return { time: start, open: price, high: price, low: price, close: price, volume: volumeGrowth };
}

/** The lower bar so far, grown by the chart bar's newest price and by the volume it gained since. */
function extendedLowerBar(lowerBar: RenderBar, chartBar: RenderBar, volumeGrowth: number): RenderBar {
  return {
    time: lowerBar.time,
    open: lowerBar.open,
    high: Math.max(lowerBar.high, chartBar.close),
    low: Math.min(lowerBar.low, chartBar.close),
    close: chartBar.close,
    volume: lowerBar.volume + volumeGrowth,
  };
}

/**
 * The volume the chart bar gained since `folded` was the bar its volume was last counted on: all of its volume
 * on a chart bar the lower bar has not seen before.
 */
function volumeGrowthOf(chartBar: RenderBar, folded: RenderBar | null): number {
  if (folded === null || folded.time !== chartBar.time) {
    return chartBar.volume;
  }
  return Math.max(0, chartBar.volume - folded.volume);
}

/**
 * One indicator's read of another timeframe's candles. It asks for the plan's pages newest first, walks back
 * while the candles it holds still end short of the chart's oldest one, and then keeps them current from the
 * chart's own bars: a higher timeframe's forming bucket is grouped from them, so a live tick and a bucket close
 * both ask the host for nothing. A lower timeframe's forming bar takes the chart's newest price, so a live tick
 * asks for nothing either, and the bar it closes asks once for the two newest candles, which replace the one
 * built here with the broker's own. A read the bridge cannot answer keeps the candles it already holds and asks
 * for nothing more.
 */
export class IndicatorSeriesRead extends LiveKeyedRead<IndicatorSeriesQuery, IndicatorSeriesAnswer> {
  private plan: SeriesReadPlan | null = null;
  private heldBars: readonly RenderBar[] = [];
  private pagesLeft: readonly number[] = [];
  /** The lower bar built from the chart's live bars, and the chart bar its volume was last counted on. */
  private formingLowerBar: RenderBar | null = null;
  private foldedChartBar: RenderBar | null = null;

  constructor(
    source: IndicatorSeriesSource,
    /** Called once candles arrived, so the indicator draws them. */
    private readonly arrived: () => void,
  ) {
    super(SERIES_KEY_PREFIX, source);
  }

  /** The timeframe this read asks for; null before it started. */
  get timeframe(): string | null {
    return this.plan?.timeframe ?? null;
  }

  /** The candles read so far, oldest first; the lower bar the chart's live bars build follows them. */
  get bars(): readonly RenderBar[] {
    const forming = this.formingLowerBar;
    const newestHeld = this.heldBars.at(-1);
    if (forming === null || (newestHeld !== undefined && newestHeld.time >= forming.time)) {
      return this.heldBars;
    }
    return [...this.heldBars, forming];
  }

  /**
   * Asks for `plan`'s pages again, from the newest one. The candles held stay on screen until the answer
   * overwrites them, so a settings change does not blank the values; a new history drops the whole read.
   */
  start(plan: SeriesReadPlan): void {
    this.listen();
    this.plan = plan;
    this.pagesLeft = plan.pages.slice(1);
    this.requestPage(plan.pages[0], null);
  }

  /**
   * Follows the chart's bars for a higher timeframe: the bucket the chart still draws is grouped from them and
   * the closed one stays as they left it, so neither a tick nor a bucket close asks the host for anything.
   */
  followHigherBars(chartBars: readonly RenderBar[]): void {
    const timeframe = this.timeframe;
    if (timeframe === null || this.heldBars.length === 0) {
      return;
    }
    this.heldBars = withFormingBucket(this.heldBars, chartBars, timeframe);
  }

  /**
   * Follows the chart's bars for a lower timeframe, building its forming bar from them. `previous` is the chart
   * bar the last update carried: once the chart opens a bar in a later lower bucket, the lower bar being built
   * closed, and only the broker's own candles can say what the ticks this read never saw did inside it.
   */
  followLowerBars(chartBars: readonly RenderBar[], previous: RenderBar): void {
    const timeframe = this.timeframe;
    const chartBar = chartBars.at(-1);
    if (timeframe === null || chartBar === undefined) {
      return;
    }
    const start = higherTimeframeBarTime(timeframe, chartBar.time);
    if (start > higherTimeframeBarTime(timeframe, previous.time)) {
      this.formingLowerBar = null;
      this.foldedChartBar = null;
      this.requestPage(CLOSED_LOWER_BAR_CANDLES, null);
    }
    const forming = this.formingLowerBar;
    const volumeGrowth = volumeGrowthOf(chartBar, this.foldedChartBar);
    this.formingLowerBar =
      forming === null || forming.time !== start
        ? openingLowerBar(start, chartBar, volumeGrowth)
        : extendedLowerBar(forming, chartBar, volumeGrowth);
    this.foldedChartBar = chartBar;
  }

  /** Drops the plan, the candles it held and the lower bar built here, so a read started again asks afresh. */
  protected dropHeld(): void {
    this.plan = null;
    this.heldBars = [];
    this.pagesLeft = [];
    this.formingLowerBar = null;
    this.foldedChartBar = null;
  }

  /** Writes the answered candles over the ones they replace, then walks back while the range is still short. */
  protected readAnswer(answer: IndicatorSeriesAnswer): void {
    if (answer.kind === 'unavailable') {
      // Nothing asked for this series again, so the candles held stay the last good ones it gave.
      this.pagesLeft = [];
      return;
    }
    const page = pageBarsOf(answer.candles);
    if (page.length === 0) {
      return;
    }
    this.heldBars = answer.beforeMs === null ? withNewestPage(this.heldBars, page) : withOlderPage(this.heldBars, page);
    this.arrived();
    this.walkBack();
  }

  /** Asks for the next older page while the plan holds one and the oldest chart candle is not reached yet. */
  private walkBack(): void {
    const plan = this.plan;
    const oldestHeld = this.heldBars[0]?.time;
    const pageBars = this.pagesLeft[0];
    if (plan?.kind !== 'paged' || pageBars === undefined || oldestHeld === undefined) {
      return;
    }
    if (oldestHeld * MILLISECONDS_PER_SECOND <= plan.oldestMs) {
      return;
    }
    this.pagesLeft = this.pagesLeft.slice(1);
    this.requestPage(pageBars, oldestHeld * MILLISECONDS_PER_SECOND);
  }

  private requestPage(bars: number | undefined, beforeMs: number | null): void {
    const timeframe = this.plan?.timeframe;
    if (bars === undefined || timeframe === undefined) {
      return;
    }
    this.requestHost({ key: this.key, timeframe, bars, beforeMs });
  }
}
