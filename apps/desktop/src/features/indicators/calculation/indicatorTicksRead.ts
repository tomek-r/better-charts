import { TICKS_PER_PAGE } from '../../../shared/bridge/config';
import type { IndicatorTick } from '../../../shared/bridge/types';
import type {
  IndicatorTicksAnswer,
  IndicatorTicksQuery,
  IndicatorTickSource,
} from '../../chart/engine/indicators/indicatorTickSource';
import { LiveKeyedRead } from './liveKeyedRead';
import {
  TICK_BUDGET,
  answersTickWindow,
  coveredTickWalk,
  endedTickWalk,
  narrowedTickWalk,
  newestTickWindow,
  nextOlderTickWindow,
  startTickWalk,
  type TickReadRange,
  type TickWalk,
  type TickWindow,
} from './tickPages';

/** The bridge's key charset is `[A-Za-z0-9_:-]`, so a read's key needs no escaping. */
const TICKS_KEY_PREFIX = 'ticks';
/** The ticks one page may ask for: the negotiated page size, never more than the read's whole budget. */
const PAGE_TICKS = Math.min(TICKS_PER_PAGE, TICK_BUDGET);

/** Whether the one request in flight walks back or reads the newest window again. */
type TicksWindowKind = 'older' | 'newest';

/** The one request in flight, and whether it walks back or reads the newest window again. */
interface PendingWindow {
  readonly window: TickWindow;
  readonly kind: TicksWindowKind;
}

/** The ticks held with a page of older ticks put in front of the ones it precedes. */
function withOlderTicks(
  held: readonly IndicatorTick[],
  window: TickWindow,
  page: readonly IndicatorTick[],
): readonly IndicatorTick[] {
  return [...page, ...held.filter((tick) => tick.timeMs >= window.toMs)];
}

/** The ticks held with the newest window's page written over the ones it replaces. */
function withNewestTicks(
  held: readonly IndicatorTick[],
  window: TickWindow,
  page: readonly IndicatorTick[],
): readonly IndicatorTick[] {
  return [...held.filter((tick) => tick.timeMs < window.fromMs), ...page];
}

/**
 * One indicator's read of the chart's raw ticks. It asks for the newest window first and walks back a window at a
 * time until the chart's oldest bar is reached or the tick budget is spent, holding the ticks contiguous so they
 * group into N-tick bars; the newest window is read again while the chart draws on. A window the bridge cannot
 * read keeps the ticks held and ends the walk back.
 */
export class IndicatorTicksRead extends LiveKeyedRead<IndicatorTicksQuery, IndicatorTicksAnswer> {
  private walk: TickWalk | null = null;
  private pending: PendingWindow | null = null;
  private ticks: readonly IndicatorTick[] = [];
  /** A closed chart bar asked for the newest window while another request was still in flight. */
  private refreshOwed = false;

  constructor(
    source: IndicatorTickSource,
    /** Called once ticks arrived, so the indicator draws them. */
    private readonly arrived: () => void,
  ) {
    super(TICKS_KEY_PREFIX, source);
  }

  /** Every tick read so far, oldest first and contiguous back from the newest instant of the range. */
  get heldTicks(): readonly IndicatorTick[] {
    return this.ticks;
  }

  /** Walks `range` from its newest window back, dropping what a previous walk held. */
  start(range: TickReadRange): void {
    this.listen();
    this.ticks = [];
    this.pending = null;
    this.refreshOwed = false;
    this.walk = startTickWalk(range);
    this.requestOlderWindow();
  }

  /** Asks for the newest window again, which a closed chart bar moved on. */
  refresh(): void {
    if (this.walk === null) {
      return;
    }
    if (this.pending !== null) {
      // One request at a time: the newest window is read once the page in flight has landed.
      this.refreshOwed = true;
      return;
    }
    this.requestNewestWindow();
  }

  /** Drops the walk and the ticks it held, so a read started again walks its range afresh. */
  protected dropHeld(): void {
    this.walk = null;
    this.pending = null;
    this.refreshOwed = false;
    this.ticks = [];
  }

  /** Takes the answer to the window in flight, then asks for the next older one while the walk continues. */
  protected readAnswer(answer: IndicatorTicksAnswer): void {
    const pending = this.pending;
    const walk = this.walk;
    if (pending === null || walk === null) {
      return;
    }
    if (answer.kind === 'page' && !answersTickWindow(answer, pending.window)) {
      // A page of a window this read replaced: the answer it waits for is still to come.
      return;
    }
    this.pending = null;
    if (answer.kind === 'unavailable') {
      // Nothing asks for these ticks again on its own, so the ticks held stay the last good ones.
      this.walk = endedTickWalk(walk);
      this.readOwedRefresh();
      return;
    }
    if (!answer.complete) {
      // A truncated page would leave a hole between it and the ticks held: ask a narrower window instead.
      this.walk = narrowedTickWalk(walk);
      this.requestOlderWindow();
      this.readOwedRefresh();
      return;
    }
    this.ticks =
      pending.kind === 'older'
        ? withOlderTicks(this.ticks, pending.window, answer.ticks)
        : withNewestTicks(this.ticks, pending.window, answer.ticks);
    if (pending.kind === 'older') {
      this.walk = coveredTickWalk(walk, pending.window);
    }
    this.arrived();
    if (pending.kind === 'older') {
      this.requestOlderWindow();
    }
    this.readOwedRefresh();
  }

  /** Reads the newest window again once the walk has nothing older to ask for, as a closed chart bar asked. */
  private readOwedRefresh(): void {
    if (!this.refreshOwed || this.pending !== null) {
      return;
    }
    this.refreshOwed = false;
    this.requestNewestWindow();
  }

  /** Reads the newest window again: the ticks near now, which a closed chart bar or a live tick moved on. */
  private requestNewestWindow(): void {
    const walk = this.walk;
    if (walk === null) {
      return;
    }
    this.request(newestTickWindow(walk, PAGE_TICKS), 'newest');
  }

  /** Asks for the walk's next older window, or stops once it reached the range start or spent its budget. */
  private requestOlderWindow(): void {
    const walk = this.walk;
    if (walk === null) {
      return;
    }
    const window = nextOlderTickWindow(walk, PAGE_TICKS, TICK_BUDGET - this.ticks.length);
    if (window === null) {
      return;
    }
    this.request(window, 'older');
  }

  private request(window: TickWindow, kind: TicksWindowKind): void {
    this.pending = { window, kind };
    this.requestHost({ key: this.key, fromMs: window.fromMs, toMs: window.toMs, maxTicks: window.maxTicks });
  }
}
