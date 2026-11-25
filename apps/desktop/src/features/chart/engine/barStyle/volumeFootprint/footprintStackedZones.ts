import { footprintRowImbalanced } from './footprintCells';
import type { BarFootprint, ChartFootprintRow } from './footprintData';
import { FOOTPRINT_SIDES, type FootprintSide } from './footprintShades';

/** The shortest stack a zone is ever built from: one level, below which no run can stack. */
const SHORTEST_STACK = 1;

/**
 * One bar as the zones read it: the range its candle spans and the footprint the host read for it. A bar the host
 * holds no whole ticks for carries no rows, and one whose close never arrived carries no range, so neither forms a
 * zone nor ends one.
 */
export interface FootprintZoneBar {
  readonly high?: number;
  readonly low?: number;
  readonly footprint?: BarFootprint;
}

/**
 * One zone of stacked imbalances: the run of consecutive rows of one bar that a side is flagged on, drawn from the
 * run's lowest price to its highest.
 */
export interface FootprintStackedZone {
  /** The bar the run belongs to, as its place among the bars the zones were computed from. */
  readonly startIndex: number;
  /** The first later bar whose range overlaps the zone's, which the zone ends at; null while none touched it. */
  readonly endIndex: number | null;
  readonly side: FootprintSide;
  readonly downPrice: number;
  readonly upPrice: number;
}

/** One zone before the bars around it are known: the side of its run and the prices that run spans. */
interface ZoneRun {
  readonly side: FootprintSide;
  readonly downPrice: number;
  readonly upPrice: number;
}

/** The count of levels as a whole number of rows, or 0 for a count no zone can be built from. */
function stackSizeOf(count: number): number {
  if (!Number.isFinite(count)) {
    return 0;
  }
  const stack = Math.floor(count);
  return stack < SHORTEST_STACK ? 0 : stack;
}

/** Whether `row` is the level right above `previous`, which is what keeps a run going across it. */
function followsRow(previous: ChartFootprintRow | undefined, row: ChartFootprintRow): boolean {
  return previous !== undefined && previous.row + 1 === row.row;
}

/** The rows of one bar that `side` is flagged on, split into runs of consecutive row numbers. */
function sideRuns(rows: readonly ChartFootprintRow[], side: FootprintSide): ChartFootprintRow[][] {
  const runs: ChartFootprintRow[][] = [];
  let current: ChartFootprintRow[] | null = null;
  for (const row of rows) {
    if (!footprintRowImbalanced(row, side)) {
      current = null;
      continue;
    }
    if (current === null || !followsRow(current[current.length - 1], row)) {
      current = [];
      runs.push(current);
    }
    current.push(row);
  }
  return runs;
}

/** The zone one run forms: from its lowest row's down price to its highest row's up price. */
function zoneOfRun(run: readonly ChartFootprintRow[], side: FootprintSide): ZoneRun {
  let downPrice = Number.POSITIVE_INFINITY;
  let upPrice = Number.NEGATIVE_INFINITY;
  for (const row of run) {
    downPrice = Math.min(downPrice, row.downPrice);
    upPrice = Math.max(upPrice, row.upPrice);
  }
  return { side, downPrice, upPrice };
}

/** Every zone one bar's rows form, one per run of at least `stack` rows on either side. */
function barZones(rows: readonly ChartFootprintRow[], stack: number): ZoneRun[] {
  const zones: ZoneRun[] = [];
  for (const side of FOOTPRINT_SIDES) {
    for (const run of sideRuns(rows, side)) {
      if (run.length >= stack) {
        zones.push(zoneOfRun(run, side));
      }
    }
  }
  return zones;
}

/** Whether a bar's own low to high range meets a zone's, which is what ends the zone. */
function overlapsZone(bar: FootprintZoneBar, zone: ZoneRun): boolean {
  if (bar.high === undefined || bar.low === undefined) {
    return false;
  }
  return bar.low <= zone.upPrice && bar.high >= zone.downPrice;
}

/** The first bar after `startIndex` whose range overlaps the zone's; null while no later bar touched it. */
function endIndexOf(bars: readonly FootprintZoneBar[], startIndex: number, zone: ZoneRun): number | null {
  for (let index = startIndex + 1; index < bars.length; index += 1) {
    const bar = bars[index];
    if (bar !== undefined && overlapsZone(bar, zone)) {
      return index;
    }
  }
  return null;
}

/**
 * Every stacked imbalance zone of `bars`: each run of at least `count` consecutive rows of one bar that the host
 * flagged on one side, from the run's lowest row's down price to its highest row's up price, ended by the first later
 * bar whose low to high range overlaps it. The bars are the whole series rather than the visible window, so a zone of
 * a bar left of the pane still draws while it reaches into it.
 */
export function footprintStackedZones(bars: readonly FootprintZoneBar[], count: number): FootprintStackedZone[] {
  const stack = stackSizeOf(count);
  if (stack === 0) {
    return [];
  }
  const zones: FootprintStackedZone[] = [];
  for (const [startIndex, bar] of bars.entries()) {
    for (const zone of barZones(bar.footprint?.rows ?? [], stack)) {
      zones.push({ ...zone, startIndex, endIndex: endIndexOf(bars, startIndex, zone) });
    }
  }
  return zones;
}
