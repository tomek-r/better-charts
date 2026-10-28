import { useEffect, type RefObject } from 'react';

/** Calls `onDismiss` when Escape is pressed while the calling component is mounted. */
export function useEscapeDismissal(onDismiss: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss]);
}

/** Calls `onDismiss` for a pointer press outside `ref`'s element. */
export function useOutsidePointerDismissal(ref: RefObject<HTMLElement | null>, onDismiss: () => void): void {
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current && !ref.current.contains(event.target)) {
        onDismiss();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ref, onDismiss]);
}
