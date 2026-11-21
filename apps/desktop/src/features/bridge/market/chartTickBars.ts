import { TICKS_PER_PAGE } from '../../../shared/bridge/config';
import { ticksPerBarOf } from '../../../shared/bridge/chartIntervals';
import type { Candle, IndicatorTick, MarketSnapshot } from '../../../shared/bridge/types';
import type { RenderBar } from '../../chart/engine/bars/renderBar';
import { foldTick, tickBarTimeline, type TickBarTimeline } from '../../chart/engine/bars/tickBarTimeline';
import type { IndicatorTicksAnswer, IndicatorTickSource } from '../../chart/engine/indicators/indicatorTickSource';
import type { ChartController } from '../../chart/engine/surface/chartController';
import {
  answersTickWindow,
  coveredTickWalk,
  endedTickWalk,
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
 * The chart's bars while a tick interval is shown: the symbol's raw ticks, read
 * backwards from the newest instant it is known to have reached, built into
 * N-tick bars and then kept live from the quotes.
 *
 * A read walks back one window at a time under `CHART_TICK_BUDGET` ticks until it
 * has `INITIAL_TICK_BARS` bars or the bridge stops answering, then replaces the
 * chart history the way an accepted MT5 snapshot does. Quotes are sampled, not
 * lossless (see docs/CURRENT_STATE.md), so a forming bar holds the ticks that
 * reached the app rather than every tick the broker saw.
 */
export class ChartTickBars {
  private walk: TickWalk | null = null;
  private pending: TickWindow | null = null;
  private heldTicks: readonly IndicatorTick[] = [];
  private timeline: TickBarTimeline | null = null;
  private drawing: { readonly symbol: string; readonly interval: string } | null = null;
  private emptyWindows = 0;
  private newestTickMs = 0;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly deps: ChartTickBarsDeps) {}

  /** Reads `interval`'s ticks of `symbol` and draws the bars they build, replacing any read in flight. */
  show(symbol: string, interval: string): void {
    if (!symbol || ticksPerBarOf(interval) === undefined) {
      return;
    }
    this.walk = startTickWalk({ oldestMs: NO_OLDEST_INSTANT_MS, newestMs: this.readEndMs() });
    this.pending = null;
    this.heldTicks = [];
    this.timeline = null;
    this.emptyWindows = 0;
    this.drawing = { symbol, interval };
    this.unsubscribe ??= this.deps.ticks.subscribe(CHART_TICKS_KEY, (answer) => this.readAnswer(answer));
    this.requestOlderWindow();
  }

  /** Folds a live quote into the forming bar of the tick interval on screen, when one is shown. */
  addTick(tick: IndicatorTick): void {
    if (tick.timeMs > this.newestTickMs) {
      this.newestTickMs = tick.timeMs;
    }
    const ticksPerBar = ticksPerBarOf(this.deps.session.currentTimeframe.current);
    if (ticksPerBar === undefined || this.timeline === null) {
      return;
    }
    const next = foldTick(this.timeline, tick, ticksPerBar);
    if (next === this.timeline) {
      return;
    }
    this.timeline = next;
    this.drawNewestBar();
  }

  /** Drops the read in flight and the bars it held, so the chart stops taking this interval's ticks. */
  stop(): void {
    this.walk = null;
    this.pending = null;
    this.heldTicks = [];
    this.timeline = null;
    this.drawing = null;
    this.emptyWindows = 0;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Takes the answer to the window in flight and asks for the next older one. */
  private readAnswer(answer: IndicatorTicksAnswer): void {
    const pending = this.pending;
    const walk = this.walk;
    const ticksPerBar = ticksPerBarOf(this.drawing?.interval);
    if (pending === null || walk === null || ticksPerBar === undefined) {
      return;
    }
    if (answer.kind === 'page' && !answersTickWindow(answer, pending)) {
      // A page of a read this one replaced: the window it waits for is still to come.
      return;
    }
    this.pending = null;
    if (answer.kind === 'unavailable') {
      // Nothing asks for these ticks again on its own: draw what the pages before it built.
      this.walk = endedTickWalk(walk);
      this.finish();
      return;
    }
    if (!answer.complete) {
      // A truncated page leaves a hole between its ticks and the ones held, so they are not
      // used: the same anchor asks a narrower window, and one at the floor ends the read.
      this.walk = narrowedTickWalk(walk);
      this.requestOlderWindow();
      return;
    }
    if (answer.ticks.length === 0) {
      this.emptyWindows += 1;
      if (this.emptyWindows >= EMPTY_WINDOW_LIMIT) {
        this.walk = endedTickWalk(walk);
        this.finish();
        return;
      }
    }
    this.heldTicks = [...answer.ticks, ...this.heldTicks];
    this.timeline = tickBarTimeline(this.heldTicks, ticksPerBar);
    this.walk = coveredTickWalk(walk, pending);
    this.requestOlderWindow();
  }

  /** Asks for the walk's next older window, or draws the bars once the read has what it came for. */
  private requestOlderWindow(): void {
    const walk = this.walk;
    if (walk === null) {
      return;
    }
    if (this.enoughBars()) {
      this.finish();
      return;
    }
    const window = nextOlderTickWindow(walk, PAGE_TICKS, CHART_TICK_BUDGET - this.heldTicks.length);
    if (window === null) {
      this.finish();
      return;
    }
    this.pending = window;
    const { fromMs, toMs, maxTicks } = window;
    this.deps.ticks.request({ key: CHART_TICKS_KEY, fromMs, toMs, maxTicks });
  }

  /** Whether the read holds what a chart opens with: a pane of bars, or its whole tick budget. */
  private enoughBars(): boolean {
    return (this.timeline?.bars.length ?? 0) >= INITIAL_TICK_BARS || this.heldTicks.length >= CHART_TICK_BUDGET;
  }

  /** Draws the bars the read built, then drops the raw ticks the timeline no longer needs. */
  private finish(): void {
    const drawing = this.drawing;
    const timeline = this.timeline;
    this.walk = null;
    this.pending = null;
    this.heldTicks = [];
    if (drawing === null || timeline === null || timeline.bars.length === 0) {
      // A read that found no ticks draws nothing and takes no live ticks either: the
      // chart keeps showing the bars of the interval it showed before.
      this.timeline = null;
      return;
    }
    this.replaceHistory(drawing.symbol, drawing.interval, timeline.bars);
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
