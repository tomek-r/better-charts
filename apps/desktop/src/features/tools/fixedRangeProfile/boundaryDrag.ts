import type { ChartDrawingCollection } from '../../chart/engine/drawings/chartDrawingCollection';
import { anchorAtX } from '../../chart/engine/tools/barAnchor';
import type { ChartToolHost } from '../../chart/engine/tools/toolContract';
import type { FixedRangeProfileDrawing } from './drawing/fixedRangeProfileDrawing';
import {
  previewBoundaryRange,
  sameRange,
  type PlacedFixedRangeProfile,
  type RangeBoundary,
} from './fixedRangeProfileRange';

/** The boundary drag in progress: the drawing it edits, which side, and the range it previews. */
export interface BoundaryDrag {
  readonly drawing: FixedRangeProfileDrawing;
  readonly side: RangeBoundary;
  readonly original: PlacedFixedRangeProfile;
  preview: PlacedFixedRangeProfile;
}

/**
 * The selected drawing's handle under the pane x, with the side that press would drag. Only a selected
 * drawing shows its handles, so only its handles can be grabbed; a locked one lets the chart pan.
 */
function grabbableHandleAt(
  host: ChartToolHost,
  drawings: ChartDrawingCollection<FixedRangeProfileDrawing>,
  x: number,
): { drawing: FixedRangeProfileDrawing; side: RangeBoundary } | null {
  const entries = drawings.entries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const { id, drawing, locked, visible, selected } = entries[index];
    const grabbable = selected && !locked && visible && host.drawingShownOnTimeframe(id);
    const side = grabbable ? drawing.handleAt(x) : null;
    if (side !== null) {
      return { drawing, side };
    }
  }
  return null;
}

/** A press on a handle starts the drag of the topmost visible unlocked drawing; null lets the chart pan. */
export function startBoundaryDrag(
  host: ChartToolHost,
  drawings: ChartDrawingCollection<FixedRangeProfileDrawing>,
  x: number,
): BoundaryDrag | null {
  const target = grabbableHandleAt(host, drawings, x);
  const original = target?.drawing.placedRange() ?? null;
  if (target === null || original === null) {
    return null;
  }
  return { drawing: target.drawing, side: target.side, original, preview: original };
}

/** Moves the dragged boundary to the bar under pane x; a position with no legal range keeps the last preview. */
export function moveBoundary(host: ChartToolHost, drag: BoundaryDrag, x: number): void {
  const anchor = anchorAtX(host, x);
  const preview = anchor === null ? null : previewBoundaryRange(host.barSeries, drag.side, drag.original, anchor);
  if (preview === null) {
    return;
  }
  drag.preview = preview;
  drag.drawing.setPreviewing(!sameRange(preview, drag.original));
  host.requestRepaint();
}

/** Ends the drag: a release that changed the range commits it, a cancel leaves the drawing as it was. */
export function finishBoundaryDrag(host: ChartToolHost, drag: BoundaryDrag, commit: boolean): void {
  drag.drawing.setPreviewing(false);
  if (commit && !sameRange(drag.original, drag.preview)) {
    drag.drawing.commitRange(drag.preview);
    host.drawingsChanged();
  }
  host.requestRepaint();
}
