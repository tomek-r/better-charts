import type { ChartDrawingPoint } from '../../../chart/engine/drawings/drawingRecord';
import type { ChartDrawingFactory } from '../../../chart/engine/drawings/toolDrawings';
import type { ChartToolHost } from '../../../chart/engine/tools/toolContract';
import { lastSlotOpenBefore } from '../range';
import type { TickProfileRequestQueue } from '../requests/tickProfileRequestQueue';
import { FixedRangeProfileDrawing } from './fixedRangeProfileDrawing';
import { readFixedRangeProfilePoints } from './fixedRangeProfilePoints';

/**
 * Turns the anchors the app stored back into FRVP drawings. A window the loaded bars cannot place
 * yet stays a drawing without a slot: it exports unchanged, and gets its profile once the bars that
 * hold it arrive. Only a window the loaded history will never reach is dropped.
 */
export class FixedRangeProfileFactory implements ChartDrawingFactory<FixedRangeProfileDrawing> {
  constructor(
    private readonly host: ChartToolHost,
    private readonly queue: TickProfileRequestQueue,
  ) {}

  restore(points: readonly ChartDrawingPoint[]): FixedRangeProfileDrawing | undefined {
    const window = readFixedRangeProfilePoints(points);
    if (window === undefined) {
      return undefined;
    }
    const lastSlotOpenMs = lastSlotOpenBefore(this.host.barSeries, window.endMs);
    const barsLoaded = this.host.barSeries.bars.length > 0;
    if (lastSlotOpenMs === undefined && barsLoaded) {
      // These bars start after the window: no slot of theirs can carry its handle.
      return undefined;
    }
    return FixedRangeProfileDrawing.restored(this.host, this.queue, window, lastSlotOpenMs);
  }
}
