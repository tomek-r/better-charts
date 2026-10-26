import type { DragEvent } from 'react';

/** Which side of a row a drop lands on: above it in the list, or below it. */
export type DropEdge = 'before' | 'after';

/** The row the pointer is over while dragging, and the side the dragged row would land on. */
export interface LayerDropIndicator {
  readonly index: number;
  readonly edge: DropEdge;
}

/** Which side of the row under the pointer a drop lands on: above its middle, or below it. */
export function dropEdgeAt(event: DragEvent<HTMLLIElement>): DropEdge {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
}

/**
 * The list index a dragged row lands on. A drop names an insertion point, and taking the row out of
 * the list shifts every index past it down one, so a move down lands one place earlier; a drop onto
 * the row's own place answers the source index, which the engine ignores.
 */
export function dropTargetIndex(source: number, target: number, edge: DropEdge): number {
  const insertAt = edge === 'before' ? target : target + 1;
  return insertAt > source ? insertAt - 1 : insertAt;
}
