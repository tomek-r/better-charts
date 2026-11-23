import type { RenderBar } from '../../chart/engine/bars/renderBar';
import type { IndicatorSeriesSource } from '../../chart/engine/indicators/indicatorSeriesSource';
import { IndicatorSeriesRead } from './indicatorSeriesRead';
import type { SeriesReadPlan } from './seriesPages';

/** The reads every chart holds, by the source it reads through and by the timeframe it reads. */
const seriesReadsBySource = new WeakMap<IndicatorSeriesSource, Map<string, SharedSeriesRead>>();

/**
 * One chart's read of a timeframe, shared by every indicator that draws it: they see the same candles and only
 * the one read asks the host. The last indicator to give it up drops it.
 */
export class SharedSeriesRead {
  private readonly arrivals = new Set<() => void>();
  private readonly read: IndicatorSeriesRead;

  constructor(
    private readonly source: IndicatorSeriesSource,
    readonly timeframe: string,
    plan: SeriesReadPlan,
  ) {
    this.read = new IndicatorSeriesRead(source, () => this.announce());
    this.read.start(plan);
  }

  /** The candles read so far, oldest first, the lower bar the chart's live bars build following them. */
  get bars(): readonly RenderBar[] {
    return this.read.bars;
  }

  /** The chart's bars moved on, and a higher timeframe's forming bucket is grouped from them. */
  followHigherBars(chartBars: readonly RenderBar[]): void {
    this.read.followHigherBars(chartBars);
  }

  /** The chart's bars moved on, and a lower timeframe's forming bar is built from them. */
  followLowerBars(chartBars: readonly RenderBar[], previous: RenderBar): void {
    this.read.followLowerBars(chartBars, previous);
  }

  /** Draws again once candles arrived, until this indicator gives the read up. */
  listen(arrival: () => void): void {
    this.arrivals.add(arrival);
  }

  /** Stops drawing `arrival`, dropping the read once no indicator draws it any more. */
  release(arrival: () => void): void {
    this.arrivals.delete(arrival);
    if (this.arrivals.size > 0) {
      return;
    }
    const reads = seriesReadsBySource.get(this.source);
    if (reads?.get(this.timeframe) === this) {
      reads.delete(this.timeframe);
    }
    this.read.dispose();
  }

  /** Stops listening for candles and drops the ones held. */
  dispose(): void {
    this.read.dispose();
  }

  /** Draws for every indicator of this timeframe, once a read answered. */
  private announce(): void {
    for (const arrival of [...this.arrivals]) {
      arrival();
    }
  }
}

/** The reads the chart behind `source` holds: an empty set of them while it holds none. */
function readsOf(source: IndicatorSeriesSource): Map<string, SharedSeriesRead> {
  const reads = seriesReadsBySource.get(source);
  if (reads !== undefined) {
    return reads;
  }
  const empty = new Map<string, SharedSeriesRead>();
  seriesReadsBySource.set(source, empty);
  return empty;
}

/**
 * The chart's read of `timeframe`, started on `plan` only when this is the first indicator to read it: every
 * later indicator of that timeframe is handed the candles already read and sends no request of its own.
 */
export function acquireSeriesRead(
  source: IndicatorSeriesSource,
  timeframe: string,
  plan: SeriesReadPlan,
  arrival: () => void,
): SharedSeriesRead {
  const reads = readsOf(source);
  const known = reads.get(timeframe);
  if (known !== undefined) {
    known.listen(arrival);
    return known;
  }
  const started = new SharedSeriesRead(source, timeframe, plan);
  started.listen(arrival);
  reads.set(timeframe, started);
  return started;
}

/** Drops every read of the chart behind `source`: the candles they hold belong to a history it replaced. */
export function dropSeriesReads(source: IndicatorSeriesSource): void {
  const reads = seriesReadsBySource.get(source);
  if (reads === undefined) {
    return;
  }
  seriesReadsBySource.delete(source);
  for (const shared of reads.values()) {
    shared.dispose();
  }
}
