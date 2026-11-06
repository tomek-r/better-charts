import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

/** A modal backdrop's pointer handlers, spread onto the backdrop element. */
export interface BackdropDismissHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onClick: (event: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * Dismisses a modal on a press of its backdrop, the way Escape does. Only a press that starts and ends on
 * the backdrop counts:
 *
 * - The press must start on the backdrop itself. A drag that starts inside the panel (selecting text, a
 *   slider, a colour square) and is released over the backdrop reports its click on the backdrop, because
 *   that is the two nodes' nearest common ancestor; that click must not close the modal.
 * - The click must land on the backdrop too, so a press that closes an open drop-down or colour picker
 *   does not also close the modal under it. `popupOpen` is read when the press starts, while the popup
 *   such a press closes is still mounted.
 */
export function useBackdropDismiss(dismiss: () => void, popupOpen: () => boolean): BackdropDismissHandlers {
  const pressStartedOnBackdrop = useRef(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    pressStartedOnBackdrop.current = event.target === event.currentTarget && !popupOpen();
  };

  const onClick = (event: ReactMouseEvent<HTMLElement>) => {
    const dismisses = pressStartedOnBackdrop.current && event.target === event.currentTarget;
    // Forgotten either way: the next click starts from a press this hook has not seen.
    pressStartedOnBackdrop.current = false;
    if (dismisses) {
      dismiss();
    }
  };

  return { onPointerDown, onClick };
}
