/** Which drawing one stack entry names: ids repeat across tools, so both halves identify it. */
export interface DrawingRef {
  readonly toolId: string;
  readonly drawingId: string;
}

/**
 * One layer of the chart's single stacking order: a drawing of one tool, or the price bars. The bars
 * are not a drawing but a marker inside the order: the drawings below it paint under the candles,
 * every drawing above it paints over them.
 */
export type DrawingStackEntry = { readonly kind: 'drawing'; readonly ref: DrawingRef } | { readonly kind: 'bars' };

/** The one bars marker, shared, so reading or clearing the order allocates nothing for it. */
const BARS_ENTRY: DrawingStackEntry = { kind: 'bars' };

/** Whether a reference list holds that drawing: ids repeat across tools, so both halves must match. */
function holdsRef(refs: readonly DrawingRef[], candidate: DrawingRef): boolean {
  return refs.some(({ toolId, drawingId }) => toolId === candidate.toolId && drawingId === candidate.drawingId);
}

/** The drawings of an entry list, in list order; the marker carries none. */
export function drawingRefs(entries: readonly DrawingStackEntry[]): DrawingRef[] {
  return entries.flatMap((entry) => (entry.kind === 'drawing' ? [entry.ref] : []));
}

/** The drawings on the two sides of the bars marker, each in list order. */
export function drawingsAroundBars(entries: readonly DrawingStackEntry[]): {
  readonly below: readonly DrawingRef[];
  readonly above: readonly DrawingRef[];
} {
  const markerIndex = entries.findIndex((entry) => entry.kind === 'bars');
  return { below: drawingRefs(entries.slice(0, markerIndex)), above: drawingRefs(entries.slice(markerIndex + 1)) };
}

/** Whether an index addresses an entry of the list. */
function isIndexIn(entries: readonly DrawingStackEntry[], index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < entries.length;
}

/** The entry of one drawing, as the order holds it. */
function drawingEntryOf(ref: DrawingRef): DrawingStackEntry {
  return { kind: 'drawing', ref };
}

/**
 * The chart's one stacking order, bottom to top, shared by every drawing of every tool. The price
 * bars are a marker inside the order rather than a layer of their own: a drawing below it paints
 * under the candles, a drawing above it over them.
 *
 * The order is exactly what the app saves: the list order of the records plus each record's
 * `belowBars` flag. Nothing else decides where a drawing paints, so the chart and the stored set can
 * never disagree.
 */
export class DrawingStack {
  /** Bottom to top, the topmost entry last. The bars marker appears here exactly once. */
  private ordered: DrawingStackEntry[] = [BARS_ENTRY];

  /**
   * The order, healed against the drawings that really exist: a stacked drawing that went away is
   * dropped, and a drawing not stacked yet is appended on top in the order given, so the drawing the
   * user just placed sits above every other. The healed order is kept.
   */
  entries(existing: readonly DrawingRef[]): readonly DrawingStackEntry[] {
    const kept = this.ordered.filter((entry) => entry.kind === 'bars' || holdsRef(existing, entry.ref));
    const stacked = drawingRefs(kept);
    const added = existing.filter((ref) => !holdsRef(stacked, ref)).map(drawingEntryOf);
    this.ordered = [...kept, ...added];
    return this.ordered;
  }

  /**
   * Rebuilds the order from a stored list: the records below the bars in list order, then the marker,
   * then the records above the bars in list order. Both sides keep their stored order.
   */
  replace(records: readonly { readonly ref: DrawingRef; readonly belowBars: boolean }[]): void {
    const below = records.filter(({ belowBars }) => belowBars).map(({ ref }) => drawingEntryOf(ref));
    const above = records.filter(({ belowBars }) => !belowBars).map(({ ref }) => drawingEntryOf(ref));
    this.ordered = [...below, BARS_ENTRY, ...above];
  }

  /**
   * Moves the entry at `fromIndex` to `toIndex`, both bottom-first indexes into `entries()`; moving a
   * drawing across the marker is what puts it under the candles or back over them. An index out of
   * range, or a move onto itself, changes nothing and answers false.
   */
  move(fromIndex: number, toIndex: number): boolean {
    if (fromIndex === toIndex || !isIndexIn(this.ordered, fromIndex) || !isIndexIn(this.ordered, toIndex)) {
      return false;
    }
    const [moved] = this.ordered.splice(fromIndex, 1);
    this.ordered.splice(toIndex, 0, moved);
    return true;
  }

  /** Drops every drawing and keeps the marker at the bottom, so the next drawing placed sits above the bars. */
  clear(): void {
    this.ordered = [BARS_ENTRY];
  }
}
