import { TICKS_PER_PAGE } from '../../../shared/bridge/config';
import { tickGroupingOf, type TickGrouping } from '../../../shared/bridge/chartIntervals';
import type { Candle, IndicatorTick, MarketSnapshot } from '../../../shared/bridge/types';
import type { RenderBar } from '../../chart/engine/bars/renderBar';
import {
  foldTick,
  heldTickBars,
  joinedTickBars,
  tickBarTimeline,
  type TickBarTimeline,
} from '../../chart/engine/bars/tickBarTimeline';
import type { IndicatorTicksAnswer, IndicatorTickSource } from '../../chart/engine/indicators/indicatorTickSource';
import type { ChartController } from '../../chart/engine/surface/chartController';
import {
  answersTickWindow,
  coveredTickWalk,
  narrowedTickWalk,
  nextOlderTickWindow,
  startTickWalk,
  type TickWalk,
  type TickWindow,
} from '../../indicators/calculation/tickPages';
import type { BridgeSessionState } from '../useBridgeSession';
import { applyAcceptedSnapshot, snapshotViewportMode } from './applyAcceptedSnapshot';

/** The raw ticks a chart's own read may hold in total: what a walk back from now may spend. */
export const CHART_TICK_BUDGET = 1_000_000;

/** The bars a tick chart opens with: a pane's worth, so the read never pages a whole day of ticks. */
export const INITIAL_TICK_BARS = 500;

const MILLISECONDS_PER_SECOND = 1000;
/** The key the chart's tick read is routed under; it is not an indicator's key. */
const CHART_TICKS_KEY = 'chart-ticks';
/** The ticks one page of a chart read asks for: the negotiated page bound every read is capped at. */
const PAGE_TICKS = Math.min(TICKS_PER_PAGE, CHART_TICK_BUDGET);
/** Epoch milliseconds: a chart read has no oldest bar to stop at, only its bar target and its budget. */
const NO_OLDEST_INSTANT_MS = 0;
/**
 * A tick window is half-open, so a read that must hold the tick stamped at the newest
 * instant the bridge is known to have reached ends this far past that instant.
 */
const HALF_OPEN_END_OFFSET_MS = 1;
/**
 * Empty windows a read walks through before it stops. A quiet minute is normal,
 * but every older window costs the bridge a history scan, so a symbol with no
 * ticks at all cannot walk back through the years one window at a time.
 */
const EMPTY_WINDOW_LIMIT = 8;

/** Whether the read is filling the pane it opened with, or taking the page an older scroll asked for. */
type ReadPhase = 'opening' | 'older';

type TickBarsSession = Pick<
  BridgeSessionState,
  | 'mt5TimeframeRef'
  | 'currentSymbol'
  | 'currentTimeframe'
  | 'dataKeyRef'
  | 'latestCandleRef'
  | 'setLatestCandle'
  | 'setSnapshot'
  | 'setChartError'
>;

/** What a tick chart reads its ticks through and draws its bars with. */
export interface ChartTickBarsDeps {
  readonly chart: { current: ChartController | null };
  readonly session: TickBarsSession;
  /** The chart symbol's raw ticks, one page of a half-open range at a time. */
  readonly ticks: IndicatorTickSource;
  /** The newest instant the bridge has reported for the feed; the desktop clock until it reports one. */
  readonly brokerNowMs: () => number;
}

/** The newest of the instants the bridge reported, or the desktop clock while it has reported none. */
export function newestKnownInstantMs(instants: readonly (number | undefined)[]): number {
  const known = instants.filter((instant): instant is number => instant !== undefined && instant > 0);
  return known.length === 0 ? Date.now() : Math.max(...known);
}

/** The candle a rendered bar is drawn from, its prices back in the wire's decimal strings. */
function candleOf(bar: RenderBar): Candle {
  return {
    timeMs: bar.time * MILLISECONDS_PER_SECOND,
    open: String(bar.open),
    high: String(bar.high),
    low: String(bar.low),
    close: String(bar.close),
    tickVolume: bar.volume,
    spread: 0,
    realVolume: 0,
  };
}

/**
 * The chart's bars while a tick-built interval is shown: the symbol's raw ticks,
 * read backwards from the newest instant it is known to have reached, built into
 * the interval's N-tick bars or seconds blocks and then kept live from the quotes.
 *
 * A read walks back one window at a time under `CHART_TICK_BUDGET` ticks until it
 * has `INITIAL_TICK_BARS` bars or the bridge stops answering, then replaces the
 * chart history the way an accepted MT5 snapshot does. Scrolling past the oldest
 * bar reads one page of older ticks and prepends the bars they build through the
 * chart's own older-history seam, rebuilt so that no bar but the newest is short
 * of the ticks its interval groups; the read stops asking once the budget is
 * spent.
 *
 * Quotes are sampled, not lossless (see docs/CURRENT_STATE.md), so a forming bar
 * holds the ticks that reached the app rather than every tick the broker saw.
 */
export class ChartTickBars {
  private walk: TickWalk | null = null;
  private pending: TickWindow | null = null;
  private heldTicks: readonly IndicatorTick[] = [];
  /** The ticks of the oldest bar the read left short, which the next older page completes. */
  private oldestTicks: readonly IndicatorTick[] = [];
  /** Every tick the read has taken, the ones dropped after drawing included: the budget counts them. */
  private heldTickCount = 0;
  /** The instant of the oldest tick read so far; an older page reads the ticks before it. */
  private oldestTickMs = 0;
  private timeline: TickBarTimeline | null = null;
  private drawing: { readonly symbol: string; readonly interval: string } | null = null;
  private emptyWindows = 0;
  private newestTickMs = 0;
  private phase: ReadPhase = 'opening';
  /** Set once nothing older will be asked for: the ticks ran out, or the budget is spent. */
  private readEnded = false;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly deps: ChartTickBarsDeps) {}

  /** Reads `interval`'s ticks of `symbol` and draws the bars they build, replacing any read in flight. */
  show(symbol: string, interval: string): void {
    if (!symbol || tickGroupingOf(interval) === undefined) {
      return;
    }
    this.forgetRead();
    this.drawing = { symbol, interval };
    this.walk = startTickWalk({ oldestMs: NO_OLDEST_INSTANT_MS, newestMs: this.readEndMs() });
    this.unsubscribe ??= this.deps.ticks.subscribe(CHART_TICKS_KEY, (answer) => this.readAnswer(answer));
    this.requestOlderWindow();
  }

  /**
   * Reads one page of ticks older than the ones the chart holds and puts the bars it builds in front of the
   * chart's, which is what a scroll past the oldest bar asks for.
   */
  requestOlderTicks(): void {
    if (this.drawing === null || this.timeline === null || this.pending !== null || this.readEnded) {
      return;
    }
    this.phase = 'older';
    if (this.budgetLeft() <= 0) {
      this.endRead();
      return;
    }
    this.emptyWindows = 0;
    this.walk = startTickWalk({ oldestMs: NO_OLDEST_INSTANT_MS, newestMs: this.oldestTickMs });
    this.requestOlderWindow();
  }

  /** Folds a live quote into the forming bar of the tick interval on screen, when one is shown. */
  addTick(tick: IndicatorTick): void {
    if (tick.timeMs > this.newestTickMs) {
      this.newestTickMs = tick.timeMs;
    }
    const grouping = tickGroupingOf(this.deps.session.currentTimeframe.current);
    if (grouping === undefined || this.timeline === null) {
      return;
    }
    const next = foldTick(this.timeline, tick, grouping);
    if (next === this.timeline) {
      return;
    }
    this.timeline = next;
    this.drawNewestBar();
  }

  /** Drops the read in flight and the bars it held, so the chart stops taking this interval's ticks. */
  stop(): void {
    this.forgetRead();
    this.drawing = null;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Forgets the ticks, bars and walk of the read, so the next page starts from nothing. */
  private forgetRead(): void {
    this.walk = null;
    this.pending = null;
    this.heldTicks = [];
    this.oldestTicks = [];
    this.heldTickCount = 0;
    this.oldestTickMs = 0;
    this.timeline = null;
    this.emptyWindows = 0;
    this.phase = 'opening';
    this.readEnded = false;
  }

  /** Takes the answer to the window in flight and asks for the next older one while it can. */
  private readAnswer(answer: IndicatorTicksAnswer): void {
    const pending = this.pending;
    const walk = this.walk;
    const grouping = tickGroupingOf(this.drawing?.interval);
    if (pending === null || walk === null || grouping === undefined) {
      return;
    }
    if (answer.kind === 'page' && !answersTickWindow(answer, pending)) {
      // A page of a read this one replaced: the window it waits for is still to come.
      return;
    }
    this.pending = null;
    if (answer.kind === 'unavailable') {
      // Nothing asks for these ticks again on its own: draw what the pages before it built.
      this.endRead();
      return;
    }
    if (!answer.complete) {
      // A truncated page leaves a hole between its ticks and the ones held, so they are not
      // used: the same anchor asks a narrower window, and one at the floor ends the read.
      this.walk = narrowedTickWalk(walk);
      this.requestOlderWindow();
      return;
    }
    this.walk = coveredTickWalk(walk, pending);
    this.heldTickCount += answer.ticks.length;
    if (answer.ticks.length === 0 && this.spentEmptyWindows()) {
      this.endRead();
      return;
    }
    if (this.phase === 'older') {
      this.takeOlderPage(answer.ticks, grouping);
      return;
    }
    this.heldTicks = [...answer.ticks, ...this.heldTicks];
    this.timeline = tickBarTimeline(this.heldTicks, grouping);
    if (this.enoughBars()) {
      this.drawOpeningBars();
      return;
    }
    this.requestOlderWindow();
  }

  /** Counts one more window that held no tick, and whether that is as many as a read walks through. */
  private spentEmptyWindows(): boolean {
    this.emptyWindows += 1;
    return this.emptyWindows >= EMPTY_WINDOW_LIMIT;
  }

  /** Draws the bars the opening read built and keeps what an older page needs to join them. */
  private drawOpeningBars(): void {
    const drawing = this.drawing;
    const grouping = tickGroupingOf(drawing?.interval);
    this.pending = null;
    if (drawing === null || grouping === undefined) {
      return;
    }
    const hold = heldTickBars(this.heldTicks, grouping);
    this.oldestTicks = hold.oldestTicks;
    this.oldestTickMs = this.heldTicks[0]?.timeMs ?? 0;
    this.heldTicks = [];
    if (hold.bars.length === 0) {
      // A read that found no whole bar draws nothing and takes no live ticks either: the
      // chart keeps showing the bars of the interval it showed before.
      this.timeline = null;
      return;
    }
    // Every bar holds the ticks its interval groups, so the next tick of a tick interval opens
    // a bar of its own, while a seconds bar keeps taking the ticks of its block until it closes.
    this.timeline = { bars: hold.bars, formingPrices: [] };
    this.replaceHistory(drawing.symbol, drawing.interval, hold.bars);
  }

  /** Joins a page of older ticks to the chart's oldest bar and puts their bars in front of it. */
  private takeOlderPage(olderTicks: readonly IndicatorTick[], grouping: TickGrouping): void {
    const timeline = this.timeline;
    const chart = this.deps.chart.current;
    if (timeline === null || chart === null) {
      this.endRead();
      return;
    }
    const hold = joinedTickBars(olderTicks, this.oldestTicks, grouping, timeline.bars[0].time);
    this.oldestTicks = hold.oldestTicks;
    this.oldestTickMs = olderTicks[0]?.timeMs ?? this.oldestTickMs;
    if (hold.bars.length === 0) {
      // The page holds fewer ticks than a bar groups: they wait for the next older window.
      this.requestOlderWindow();
      return;
    }
    this.timeline = { bars: [...hold.bars, ...timeline.bars], formingPrices: timeline.formingPrices };
    chart.appendOlderHistory(hold.bars.map(candleOf), this.budgetLeft() > 0);
    if (this.budgetLeft() <= 0) {
      // The page in flight was the last one a chart may hold: nothing older is asked for again.
      this.stopAsking();
    }
  }

  /** Asks for the walk's next older window, or ends the read once there is none left to ask for. */
  private requestOlderWindow(): void {
    const walk = this.walk;
    if (walk === null) {
      return;
    }
    const window = nextOlderTickWindow(walk, PAGE_TICKS, this.budgetLeft());
    if (window === null) {
      this.endRead();
      return;
    }
    this.pending = window;
    const { fromMs, toMs, maxTicks } = window;
    this.deps.ticks.request({ key: CHART_TICKS_KEY, fromMs, toMs, maxTicks });
  }

  /** Whether the read holds what a chart opens with: a pane of bars. */
  private enoughBars(): boolean {
    return (this.timeline?.bars.length ?? 0) >= INITIAL_TICK_BARS;
  }

  /** The ticks the chart's read may still hold: the whole budget, less every page read so far. */
  private budgetLeft(): number {
    return CHART_TICK_BUDGET - this.heldTickCount;
  }

  /** Ends the read: what the opening found is drawn, and the chart's paging learns there is no more history. */
  private endRead(): void {
    const opening = this.phase === 'opening';
    this.stopAsking();
    if (opening) {
      this.drawOpeningBars();
      return;
    }
    this.deps.chart.current?.appendOlderHistory([], false);
  }

  /** Stops asking for ticks, so no page follows the one that ended the read. */
  private stopAsking(): void {
    this.walk = null;
    this.pending = null;
    this.readEnded = true;
  }

  /** Replaces the chart history with `bars`, exactly as an accepted MT5 snapshot replaces it. */
  private replaceHistory(symbol: string, interval: string, bars: readonly RenderBar[]): void {
    const { chart, session } = this.deps;
    const candles = bars.map(candleOf);
    const accepted: MarketSnapshot = { symbol, timeframe: interval, complete: true, candles };
    const hasBars = (chart.current?.getData().length ?? 0) > 0;
    const viewportMode = snapshotViewportMode(session.currentSymbol.current, hasBars, symbol);
    try {
      applyAcceptedSnapshot({ chart, adapter: null, session }, accepted, {
        receivedCandleCount: candles.length,
        viewportMode,
      });
      session.setSnapshot(accepted);
    } catch {
      session.setChartError('Tick bars could not be rendered.');
    }
  }

  /** Draws the bar the newest tick belongs to, which the chart appends or replaces in place. */
  private drawNewestBar(): void {
    const bars = this.timeline?.bars ?? [];
    const newest = bars[bars.length - 1];
    const { chart, session } = this.deps;
    if (newest === undefined || !chart.current) {
      return;
    }
    const candle = candleOf(newest);
    chart.current.updateCandle(candle);
    session.latestCandleRef.current = candle;
    session.setLatestCandle(candle);
  }

  /** Where a read ends: just past the newest instant the chart symbol is known to have reached. */
  private readEndMs(): number {
    const newestBarMs = this.deps.session.latestCandleRef.current?.timeMs;
    const newestKnownMs = newestKnownInstantMs([this.newestTickMs, this.deps.brokerNowMs(), newestBarMs]);
    return newestKnownMs + HALF_OPEN_END_OFFSET_MS;
  }
}
