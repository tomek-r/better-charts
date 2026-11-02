import type { PointerEvent, PointerEventHandler } from 'react';
import { clampUnit } from '../../../theme/colorSpace';

/** Where a pointer press landed inside a control: each axis as a 0..1 fraction of that control's box. */
export interface PointerPoint {
  readonly x: number;
  readonly y: number;
}

interface DragHandlers {
  readonly onPointerDown: PointerEventHandler<HTMLElement>;
  readonly onPointerMove: PointerEventHandler<HTMLElement>;
  readonly onPointerUp: PointerEventHandler<HTMLElement>;
}

/** The pointer's place in the control it is measured in, both axes clamped to the box. */
function pointOf(event: PointerEvent<HTMLElement>): PointerPoint {
  const box = event.currentTarget.getBoundingClientRect();
  return {
    x: clampUnit((event.clientX - box.left) / box.width),
    y: clampUnit((event.clientY - box.top) / box.height),
  };
}

/**
 * The handlers of a control that follows the pointer: a press captures the pointer, every move it makes
 * afterwards reports a point, and letting go releases it. Spreading them on the control's element is enough.
 */
export function dragHandlers(onDrag: (point: PointerPoint) => void): DragHandlers {
  return {
    onPointerDown: (event) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      onDrag(pointOf(event));
    },
    onPointerMove: (event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        onDrag(pointOf(event));
      }
    },
    onPointerUp: (event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
  };
}
