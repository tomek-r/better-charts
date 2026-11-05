import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

/** The drag keeps at least this much of the panel inside the window, and its top edge never above it. */
const HANDLE_MIN_VISIBLE_PX = 48;

/** A press on one of these belongs to the control under it: the × and the header's buttons keep working. */
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [role="button"], [contenteditable="true"]';

/** The primary pointer button: a drag is never a right or middle click, which the page may use for its own menus. */
const PRIMARY_BUTTON = 0;

/** How far the panel stands from where the modal put it. It starts at zero on every mount and is never stored. */
interface PanelOffset {
  readonly x: number;
  readonly y: number;
}

/** One axis of the drag: how far the offset may go before the panel leaves the window's edge. */
interface OffsetRange {
  readonly min: number;
  readonly max: number;
}

/** The offset extremes of a drag, measured from where the panel stood when the pointer pressed. */
interface DragLimits {
  readonly x: OffsetRange;
  readonly y: OffsetRange;
}

/**
 * The drag in progress: the pointer that owns it, where it pressed, the offset the panel already had when the
 * press began, and how far each axis may go.
 */
interface PanelDrag extends DragLimits {
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  /** The offset the panel stood at when this press began: a second drag moves on from it, never back to zero. */
  readonly startOffset: PanelOffset;
}

const UNDRAGGED: PanelOffset = { x: 0, y: 0 };

/** What a draggable panel spreads: the offset style on the panel, the press handler on the header that drags it. */
export interface DraggablePanel {
  readonly panelStyle: CSSProperties;
  readonly onHandlePointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
}

function clamped(value: number, range: OffsetRange): number {
  return Math.min(Math.max(value, range.min), range.max);
}

/** Whether the press landed on a control inside the header, which owns the press instead of the drag. */
function pressedControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
}

/** How far a drag starting at `originLeft`/`originTop` may move the panel, so it always stays in reach. */
function dragLimits(originLeft: number, originTop: number, width: number): DragLimits {
  return {
    x: {
      // The panel's right edge stops `HANDLE_MIN_VISIBLE_PX` inside the window when it is dragged left, and its
      // left edge stops the same distance from the right edge when it is dragged right.
      min: HANDLE_MIN_VISIBLE_PX - width - originLeft,
      max: window.innerWidth - HANDLE_MIN_VISIBLE_PX - originLeft,
    },
    // Upwards the panel's top edge stops at the window's top; downwards its header stays reachable.
    y: { min: -originTop, max: window.innerHeight - HANDLE_MIN_VISIBLE_PX - originTop },
  };
}

/** `offset` re-clamped to the window as it is now, from the place the panel would stand without it. */
function reclampedOffset(panel: HTMLElement, offset: PanelOffset): PanelOffset {
  const rect = panel.getBoundingClientRect();
  const limits = dragLimits(rect.left - offset.x, rect.top - offset.y, rect.width);
  const x = clamped(offset.x, limits.x);
  const y = clamped(offset.y, limits.y);
  return x === offset.x && y === offset.y ? offset : { x, y };
}

/**
 * Drags a modal's panel by its header. The offset lives in component state only, so nothing stores it: every
 * opening starts where the modal puts the panel (centred, or at its fixed offset) and the drag is forgotten
 * with the unmount.
 *
 * Invariants: only the primary button drags, a press on a control inside the header (the ×, a header button)
 * stays that control's press, and `dragLimits` clamps the offset so the panel always stays in reach: during a
 * drag, and again when the window shrinks under a panel left dragged aside. The offset is the CSS `translate`
 * property, which composes with the open and close keyframes instead of overriding their `transform`.
 */
export function useDraggablePanel(panelRef: RefObject<HTMLElement | null>): DraggablePanel {
  const [offset, setOffset] = useState<PanelOffset>(UNDRAGGED);
  const drag = useRef<PanelDrag | null>(null);
  // Aborts the pointer listeners of the drag in progress, so a finished or abandoned drag leaves none behind.
  const dragListeners = useRef<AbortController | null>(null);

  const dropDragListeners = useCallback(() => {
    dragListeners.current?.abort();
    dragListeners.current = null;
    drag.current = null;
  }, []);

  const followPointer = useCallback((event: PointerEvent) => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    setOffset({
      x: clamped(current.startOffset.x + event.clientX - current.startX, current.x),
      y: clamped(current.startOffset.y + event.clientY - current.startY, current.y),
    });
  }, []);

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const panel = panelRef.current;
    if (event.button !== PRIMARY_BUTTON || pressedControl(event.target) || panel === null) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    // The rect carries the offset a panel dragged before still has, so the modal's own place is the rect
    // minus that offset.
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: offset,
      ...dragLimits(rect.left - offset.x, rect.top - offset.y, rect.width),
    };
    // A drag selects nothing, and the captured pointer keeps its moves and its release on the header.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const controller = new AbortController();
    dragListeners.current = controller;
    event.currentTarget.addEventListener('pointermove', followPointer, { signal: controller.signal });
    event.currentTarget.addEventListener('pointerup', dropDragListeners, { signal: controller.signal });
    event.currentTarget.addEventListener('pointercancel', dropDragListeners, { signal: controller.signal });
  };

  const dragged = offset.x !== 0 || offset.y !== 0;
  const reclampToWindow = useEffectEvent(() => {
    const panel = panelRef.current;
    if (panel !== null) {
      setOffset(reclampedOffset(panel, offset));
    }
  });

  // A window that shrinks under a panel dragged aside would leave it out of reach, so a resize re-clamps the
  // standing offset with the drag's own limits, measured from where the panel stands now.
  useEffect(() => {
    if (!dragged) {
      return;
    }
    window.addEventListener('resize', reclampToWindow);
    return () => window.removeEventListener('resize', reclampToWindow);
  }, [dragged]);

  // A modal can unmount with its header held down, so no listener may outlive the drag's element.
  useEffect(() => dropDragListeners, [dropDragListeners]);

  return { panelStyle: { translate: `${offset.x}px ${offset.y}px` }, onHandlePointerDown };
}
