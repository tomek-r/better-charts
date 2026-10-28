import { useEffect, useRef, type RefObject } from 'react';

/**
 * Calls `onOutsidePress` for a pointer press outside both elements: a popup and the control that opens it.
 * The control counts as inside, so pressing it again is its own toggle and not a dismissal followed by a reopen.
 */
export function useOutsidePress(
  popupRef: RefObject<HTMLElement | null>,
  anchorRef: RefObject<HTMLElement | null>,
  onOutsidePress: () => void,
): void {
  // Latest callback without re-subscribing the document listener on every render.
  const latestCallback = useRef(onOutsidePress);
  useEffect(() => {
    latestCallback.current = onOutsidePress;
  });
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const { target } = event;
      const inside = [popupRef.current, anchorRef.current].some(
        (element) => target instanceof Node && element?.contains(target),
      );
      if (!inside) {
        latestCallback.current();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [popupRef, anchorRef]);
}
