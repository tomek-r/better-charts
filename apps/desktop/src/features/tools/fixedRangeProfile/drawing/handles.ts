import type { RenderViewport } from '../../../chart/engine/surface/overlayRenderer';
import type { ChartToolGeometry } from '../../../chart/engine/tools/toolContract';
import { DASHED_LINE_PATTERN } from '../../../../shared/canvas/dashPatterns';
import { palette } from '../../../../shared/theme/palette';
import type { PlacedFixedRangeProfile, RangeBoundary } from '../fixedRangeProfileRange';

/** How close to a handle a press or a hit test counts as that handle, in pane CSS px. */
const HANDLE_HIT_PX = 7;
/** Radius of a handle circle, in pane CSS px. */
const HANDLE_RADIUS_PX = 4;

/**
 * The pane x of the two selection handles. The loading band spans exactly these: `state.range.toMs`
 * is the request end clipped to the live edge, so it stops at the newest bar when the handle sits
 * on a future slot.
 */
export interface HandleEdges {
  fromX: number;
  toX: number;
}

/** Whether a pane point lies outside the plot area, where no drawing is hit. */
export function outsidePane(chartRect: { width: number; height: number }, x: number, y: number): boolean {
  return x < 0 || x > chartRect.width || y < 0 || y > chartRect.height;
}

/** The pane x of both handles of one range: what a hit test and the two boundary lines measure against. */
export function handleXsFor(geometry: ChartToolGeometry, range: PlacedFixedRangeProfile): HandleEdges {
  return { fromX: geometry.timeToX(range.fromMs), toX: geometry.timeToX(range.lastSlotOpenMs) };
}

/** Which boundary a press at pane x would drag, null when x is not on a handle. */
export function boundaryAtX({ fromX, toX }: HandleEdges, x: number): RangeBoundary | null {
  if (Math.abs(x - fromX) <= HANDLE_HIT_PX) {
    return 'from';
  }
  return Math.abs(x - toX) <= HANDLE_HIT_PX ? 'end' : null;
}

/**
 * The two dashed boundary lines and their handle circles, painted at the given pane x. A committed
 * drawing paints them only while selected, a half-placed range while its second click is pending.
 */
export function drawHandles(ctx: CanvasRenderingContext2D, viewport: RenderViewport, handles: HandleEdges): void {
  const { height } = viewport.chartRect;
  ctx.strokeStyle = palette.textLabel;
  ctx.lineWidth = 1;
  ctx.setLineDash(DASHED_LINE_PATTERN);
  for (const x of [handles.fromX, handles.toX]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(x, height / 2, HANDLE_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = palette.panel;
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash(DASHED_LINE_PATTERN);
  }
  ctx.setLineDash([]);
}
