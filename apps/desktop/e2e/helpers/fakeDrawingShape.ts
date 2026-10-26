import type { ChartDrawingPoint } from '../../src/features/chart/engine/drawings/drawingRecord';
import type { ChartDrawingShape } from '../../src/features/chart/engine/drawings/toolDrawings';

/**
 * A drawing of the engine's shared collection, for specs that need one without a tool: it is hit at
 * one pane x and it records what the collection told it. The collection specs and the tool set specs
 * share it, so neither has to restate a drawing's three duties.
 */

/** One time-only anchor: the shape most fake drawings store. */
export const FAKE_ANCHOR: ChartDrawingPoint = { timeMs: 1_000, price: null };

export class FakeDrawingShape implements ChartDrawingShape {
  /** What the collection told this drawing, in order: `shown`, `hidden` or `disposed`. */
  readonly events: string[] = [];
  /** The pane x this drawing answers `contains` for; y is not part of the fake. */
  readonly hitAtX: number;
  private readonly stored: readonly ChartDrawingPoint[];

  constructor(hitAtX: number, stored: readonly ChartDrawingPoint[] = [FAKE_ANCHOR]) {
    this.hitAtX = hitAtX;
    this.stored = stored;
  }

  points(): ChartDrawingPoint[] {
    return [...this.stored];
  }

  contains(x: number): boolean {
    return x === this.hitAtX;
  }

  visibilityChanged(visible: boolean): void {
    this.events.push(visible ? 'shown' : 'hidden');
  }

  dispose(): void {
    this.events.push('disposed');
  }
}
