import { timeframeSeconds } from '../../../shared/bridge/timeframes';
import type { RenderBar } from '../../chart/engine/bars/renderBar';

/** The raw ticks one chart's read holds at most, in total: what a walk back from now may spend. */
export const TICK_BUDGET = 200_000;

/** The window a walk asks for first: the newest minute of a feed, which one page holds at any realistic rate. */
const FIRST_WINDOW_MS = 60_000;
/** A window a page covered whole asks twice as wide next time, so a quiet range needs few pages. */
const WINDOW_GROWTH = 2;
/** A truncated page narrows its window; a page that does not fit a window this narrow ends the walk. */
const NARROWEST_WINDOW_MS = 1_000;
const MILLISECONDS_PER_SECOND = 1000;

/** The instants a chart's loaded bars ask ticks for: its oldest bar's open, and its newest bar's end. */
export interface TickReadRange {
  readonly oldestMs: number;
  readonly newestMs: number;
}

/** One request of a tick read: the half-open window it reads and the ticks it may carry. */
export interface TickWindow {
  readonly fromMs: number;
  readonly toMs: number;
  readonly maxTicks: number;
}

/** How far back a read has walked, and where the window of its next older page ends. */
export interface TickWalk {
  readonly oldestMs: number;
  readonly newestMs: number;
  /** Every tick at or after this instant is already held; a walk that reached `oldestMs` has nothing left. */
  readonly anchorMs: number;
  readonly windowMs: number;
}

/** The tick range of a chart's loaded bars, or null while it holds none. */
export function tickReadRange(chartBars: readonly RenderBar[], chartTimeframe: string): TickReadRange | null {
  const oldest = chartBars[0];
  const newest = chartBars.at(-1);
  if (oldest === undefined || newest === undefined) {
    return null;
  }
  return {
    oldestMs: oldest.time * MILLISECONDS_PER_SECOND,
    newestMs: (newest.time + timeframeSeconds(chartTimeframe)) * MILLISECONDS_PER_SECOND,
  };
}

/** A fresh walk over `range`, whose first page asks for the newest window. */
export function startTickWalk(range: TickReadRange): TickWalk {
  return { oldestMs: range.oldestMs, newestMs: range.newestMs, anchorMs: range.newestMs, windowMs: FIRST_WINDOW_MS };
}

/** A walk that asks for no older page any more: the range start was reached, or the page bound refused it. */
export function endedTickWalk(walk: TickWalk): TickWalk {
  return { ...walk, anchorMs: walk.oldestMs };
}

/**
 * The window the walk's next older page asks for, or null once it reached the range start or spent the ticks it
 * may still hold. The window never starts before the range and asks for no more ticks than are left.
 */
export function nextOlderTickWindow(walk: TickWalk, pageTicks: number, budgetLeft: number): TickWindow | null {
  if (walk.anchorMs <= walk.oldestMs || budgetLeft <= 0) {
    return null;
  }
  return {
    fromMs: Math.max(walk.oldestMs, walk.anchorMs - walk.windowMs),
    toMs: walk.anchorMs,
    maxTicks: Math.min(pageTicks, budgetLeft),
  };
}

/** The window a refresh asks for: the newest window again, over the ticks the walk already holds there. */
export function newestTickWindow(walk: TickWalk, pageTicks: number): TickWindow {
  return { fromMs: walk.newestMs - walk.windowMs, toMs: walk.newestMs, maxTicks: pageTicks };
}

/** The walk after a page that covered its whole window: the anchor moves to its start and the window widens. */
export function coveredTickWalk(walk: TickWalk, window: TickWindow): TickWalk {
  return { ...walk, anchorMs: window.fromMs, windowMs: walk.windowMs * WINDOW_GROWTH };
}

/**
 * The walk after a page the page bound truncated: the same anchor asks a narrower window, and a window already
 * at the floor ends the walk instead, because a narrower page would leave a hole in the ticks held.
 */
export function narrowedTickWalk(walk: TickWalk): TickWalk {
  const windowMs = Math.floor(walk.windowMs / WINDOW_GROWTH);
  return windowMs < NARROWEST_WINDOW_MS ? endedTickWalk(walk) : { ...walk, windowMs };
}
