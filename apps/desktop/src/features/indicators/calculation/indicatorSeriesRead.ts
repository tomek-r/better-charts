import type { Candle } from '../../../shared/bridge/types';
import { toRenderBar, type RenderBar } from '../../chart/engine/bars/renderBar';
import type { IndicatorSeriesAnswer, IndicatorSeriesSource } from '../../chart/engine/indicators/indicatorSeriesSource';
import type { SeriesReadPlan } from './seriesPages';

/** The shortest gap between two live requests of the newest page: as often as a tick may have moved it. */
const LIVE_REFRESH_INTERVAL_MS = 2000;
const MILLISECONDS_PER_SECOND = 1000;
/** The bridge's key charset is `[A-Za-z0-9_:-]`, so a read's key needs no escaping. */
const SERIES_KEY_PREFIX = 'calculation';

let nextSeriesNumber = 1;

/** A key no other read holds, so two reads of one timeframe never consume each other's answer. */
function seriesKey(): string {
  const key = `${SERIES_KEY_PREFIX}${nextSeriesNumber}`;
  nextSeriesNumber += 1;
  return key;
}

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

/**
 * One indicator's read of another timeframe's candles. It asks for the plan's pages newest first, walks back
 * while the candles it holds still end short of the chart's oldest one, and keeps the newest page current while
 * the chart draws. A read the bridge cannot answer keeps the candles it already holds and asks for nothing more.
 */
export class IndicatorSeriesRead {
  private readonly key = seriesKey();
  private plan: SeriesReadPlan | null = null;
  private heldBars: readonly RenderBar[] = [];
  private pagesLeft: readonly number[] = [];
  private requestedAtMs = 0;
  private listening = false;
  private stopListening: () => void = () => undefined;

  constructor(
    private readonly source: IndicatorSeriesSource,
    /** Called once candles arrived, so the indicator draws them. */
    private readonly arrived: () => void,
  ) {}

  /** The timeframe this read asks for; null before it started. */
  get timeframe(): string | null {
    return this.plan?.timeframe ?? null;
  }

  /** The candles read so far, oldest first; empty until an answer arrives. */
  get bars(): readonly RenderBar[] {
    return this.heldBars;
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

  /** Asks for the newest page again: a bar of the timeframe closed, or its forming bar moved on. */
  refresh(): void {
    this.requestPage(this.plan?.pages[0], null);
  }

  /** Asks for the newest page at most every two seconds, which is as often as live ticks have moved it. */
  refreshLive(): void {
    if (Date.now() - this.requestedAtMs < LIVE_REFRESH_INTERVAL_MS) {
      return;
    }
    this.refresh();
  }

  dispose(): void {
    this.stopListening();
    this.listening = false;
    this.stopListening = () => undefined;
    this.plan = null;
    this.heldBars = [];
    this.pagesLeft = [];
  }

  /** Writes the answered candles over the ones they replace, then walks back while the range is still short. */
  private readAnswer(answer: IndicatorSeriesAnswer): void {
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
    this.requestedAtMs = Date.now();
    this.source.request({ key: this.key, timeframe, bars, beforeMs });
  }

  private listen(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    this.stopListening = this.source.subscribe(this.key, (answer) => this.readAnswer(answer));
  }
}
