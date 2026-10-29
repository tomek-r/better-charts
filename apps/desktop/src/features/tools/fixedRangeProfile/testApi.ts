import type { ChartDrawingCollection } from '../../chart/engine/drawings/chartDrawingCollection';
import type { BoundaryDrag } from './boundaryDrag';
import type { FixedRangeProfileDrawing } from './drawing/fixedRangeProfileDrawing';

/** Where the two drag handles sit, in pane CSS px, and the range they delimit. */
interface FixedRangeProfileBoundaries {
  fromX: number;
  toX: number;
  range: { fromMs: number; endMs: number };
}

/** What the e2e suite reads through `window.__chartTest.tool('fixedRangeProfile')` (dev builds only). */
export interface FixedRangeProfileTestApi {
  /** Handle x positions and the range of the shown drawing; null when the tool has no drawing. */
  boundaries(): FixedRangeProfileBoundaries | null;
  /** The shown drawing's requested range and whether its computed profile is loaded and visible. */
  selection(): { range: { fromMs: number; toMs: number } | null; hasProfile: boolean };
  /** Every drawing, bottom to top. */
  drawings(): Array<{
    id: string;
    locked: boolean;
    range: { fromMs: number; endMs: number };
    hasProfile: boolean;
    /** Whether the last paint drew the boundary lines and circles. */
    handlesShown: boolean;
  }>;
}

/** The drawing a hit test or the e2e suite shows: the selected one, else the one painted last. */
function shownDrawing(
  drawings: ChartDrawingCollection<FixedRangeProfileDrawing>,
): FixedRangeProfileDrawing | undefined {
  const entries = drawings.entries();
  return (entries.find((entry) => entry.selected) ?? entries.at(-1))?.drawing;
}

/** The test API over the tool's drawings; `currentDrag` is read per call because a drag starts and ends later. */
export function createFixedRangeProfileTestApi(
  drawings: ChartDrawingCollection<FixedRangeProfileDrawing>,
  currentDrag: () => BoundaryDrag | null,
): FixedRangeProfileTestApi {
  return {
    boundaries: () => {
      const drawing = shownDrawing(drawings);
      const placed = drawing?.placedRange() ?? null;
      if (drawing === undefined || placed === null) {
        return null;
      }
      const drag = currentDrag();
      const range = drag?.drawing === drawing ? drag.preview : placed;
      return { ...drawing.handleXs(range), range: { fromMs: range.fromMs, endMs: range.endMs } };
    },
    selection: () => {
      const drawing = shownDrawing(drawings);
      const requested = drawing?.state.range;
      const range = requested ? { fromMs: requested.fromMs, toMs: requested.toMs } : null;
      return { range, hasProfile: drawing?.hasProfile() ?? false };
    },
    drawings: () =>
      drawings.entries().map(({ id, locked, drawing }) => ({
        id,
        locked,
        ...drawing.summary(),
        handlesShown: drawing.wereHandlesPainted(),
      })),
  };
}
