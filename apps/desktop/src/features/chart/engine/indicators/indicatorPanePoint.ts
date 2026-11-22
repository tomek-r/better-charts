import type { MouseEventParams, Time } from 'lightweight-charts';

/** Where a pointer rests in the pane it is over: the pane's index and the point in that pane's CSS pixels. */
export interface PanePoint {
  readonly paneIndex: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The pane a pointer rests in and where it rests there, as the library reports it on a crosshair move and
 * on a click: `point` is already in the pane's CSS pixels and `paneIndex` names the pane, so no pane is
 * measured and a move costs the page no layout. A param that names no point or no pane reads as null.
 */
export function panePointOf(param: MouseEventParams<Time>): PanePoint | null {
  const { point } = param;
  // The pane is absent while the pointer rests off every pane, so it is read as the optional field it is.
  const paneIndex: number | undefined = param.paneIndex;
  if (point === undefined || paneIndex === undefined) {
    return null;
  }
  return { paneIndex, x: point.x, y: point.y };
}
