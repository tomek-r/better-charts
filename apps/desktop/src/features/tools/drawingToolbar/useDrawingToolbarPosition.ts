import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** Where the toolbar stands in the chart frame: the centred default, or the place the user dragged it to. */
export type DrawingToolbarPosition =
  { readonly anchor: 'topCentre' } | { readonly anchor: 'dragged'; readonly left: number; readonly top: number };

/** The grip button's drag handlers, spread onto the button. */
export interface GripHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

/** The drag in progress: the pointer that owns it, where it grabbed the panel, and how far the panel may go. */
interface GripDrag {
  readonly pointerId: number;
  readonly grabX: number;
  readonly grabY: number;
  readonly frameLeft: number;
  readonly frameTop: number;
  readonly farthestLeft: number;
  readonly farthestTop: number;
}

/** One offset kept between the frame's edges, so no part of the panel can leave the frame. */
function clamped(offset: number, farthest: number): number {
  return Math.min(Math.max(offset, 0), Math.max(farthest, 0));
}

/**
 * Drags a panel by its grip inside the chart frame. It starts centred at the top edge, follows the
 * pointer from there, and stops at the frame's edges. The place it was left lives in component state,
 * so it is remembered for the session and never stored.
 */
export function useDrawingToolbarPosition(panel: HTMLElement | null): {
  position: DrawingToolbarPosition;
  gripHandlers: GripHandlers;
} {
  const [position, setPosition] = useState<DrawingToolbarPosition>({ anchor: 'topCentre' });
  const drag = useRef<GripDrag | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    // The panel is absolutely positioned inside the chart frame, so that frame is its offsetParent.
    const frame = panel?.offsetParent;
    if (!panel || !(frame instanceof HTMLElement)) {
      return;
    }
    const frameRect = frame.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      grabX: event.clientX - panelRect.left,
      grabY: event.clientY - panelRect.top,
      frameLeft: frameRect.left,
      frameTop: frameRect.top,
      farthestLeft: frame.clientWidth - panel.offsetWidth,
      farthestTop: frame.clientHeight - panel.offsetHeight,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    // The drag continues from where the panel stands now, its centred default included.
    setPosition({ anchor: 'dragged', left: panelRect.left - frameRect.left, top: panelRect.top - frameRect.top });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    setPosition({
      anchor: 'dragged',
      left: clamped(event.clientX - current.frameLeft - current.grabX, current.farthestLeft),
      top: clamped(event.clientY - current.frameTop - current.grabY, current.farthestTop),
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId === event.pointerId) {
      drag.current = null;
    }
  };

  return {
    position,
    gripHandlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}
