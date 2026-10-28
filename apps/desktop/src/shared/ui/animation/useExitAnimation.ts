import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { afterExitAnimation } from './afterExitAnimation';

/** One exit in flight: whether it is playing, and the way to start it. */
export interface ExitAnimation {
  /** The exit animation is playing, so the element renders its leaving look. */
  exiting: boolean;
  /** Starts the exit once, running `onExited` when the animation ends; later calls are ignored. */
  startExit: (onExited: () => void) => void;
}

/**
 * The exit every animated surface plays before it goes: the `animationend` of `elementRef` runs
 * `onExited`, and a guard in a ref keeps a held key or a double click from starting that exit twice.
 * Under reduced motion the callback runs straight away (see `afterExitAnimation`).
 */
export function useExitAnimation(elementRef: RefObject<HTMLElement | null>): ExitAnimation {
  const [exiting, setExiting] = useState(false);
  const exitStarted = useRef(false);
  const startExit = useCallback(
    (onExited: () => void) => {
      if (exitStarted.current) {
        return;
      }
      exitStarted.current = true;
      setExiting(true);
      afterExitAnimation(elementRef.current, onExited);
    },
    [elementRef],
  );
  return { exiting, startExit };
}
