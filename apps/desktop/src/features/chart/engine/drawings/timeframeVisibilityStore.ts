import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  isShownOnTimeframe,
  type DrawingTimeframeVisibility,
} from './timeframeVisibility';
import type { DrawingRef } from './drawingStack';

/** What an import hands over for one drawing: where it lives and on which timeframes it paints. */
interface StoredTimeframeVisibility {
  readonly toolId: string;
  readonly id: string;
  readonly timeframeVisibility: DrawingTimeframeVisibility;
}

/** Ids repeat across tools, so both halves key a drawing; the separator cannot appear in a tool id. */
function keyOf({ toolId, drawingId }: DrawingRef): string {
  return `${toolId}\n${drawingId}`;
}

/**
 * On which timeframes each drawing paints, for every tool of the chart. A drawing it does not hold is
 * shown everywhere, so only the drawings the user restricted take space here.
 */
export class TimeframeVisibilityStore {
  private readonly byDrawing = new Map<string, DrawingTimeframeVisibility>();

  of(ref: DrawingRef): DrawingTimeframeVisibility {
    return this.byDrawing.get(keyOf(ref)) ?? DEFAULT_TIMEFRAME_VISIBILITY;
  }

  isShown(ref: DrawingRef, timeframeWire: string): boolean {
    return isShownOnTimeframe(this.of(ref), timeframeWire);
  }

  set(ref: DrawingRef, visibility: DrawingTimeframeVisibility): void {
    if (visibility === DEFAULT_TIMEFRAME_VISIBILITY) {
      this.byDrawing.delete(keyOf(ref));
      return;
    }
    this.byDrawing.set(keyOf(ref), visibility);
  }

  remove(ref: DrawingRef): void {
    this.byDrawing.delete(keyOf(ref));
  }

  /** Forgets every drawing, then holds the ones the records name. */
  replace(records: readonly StoredTimeframeVisibility[]): void {
    this.byDrawing.clear();
    for (const { toolId, id, timeframeVisibility } of records) {
      this.set({ toolId, drawingId: id }, timeframeVisibility);
    }
  }

  clear(): void {
    this.byDrawing.clear();
  }
}
