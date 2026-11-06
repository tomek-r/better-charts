import { useCallback, useRef, type RefObject } from 'react';
import { useEventCallback } from '../../identity/useEventCallback';
import { useExitAnimation } from '../animation/useExitAnimation';

/** What a `ModalDialog` owner renders on its dialog, and the one command that closes it. */
export interface ModalExit {
  /** Goes on the dialog's `backdropRef`: that backdrop's `animationend` ends the exit. */
  readonly backdropRef: RefObject<HTMLDivElement | null>;
  /** Goes on the dialog's `closing`: the backdrop and its panel play the exit animation while it holds. */
  readonly closing: boolean;
  /** Starts the exit once and runs `onClosed` when it ends, so the owner unmounts the dialog then. */
  readonly close: () => void;
}

/**
 * The one way a `ModalDialog` owner closes its dialog, so every modal of the app leaves with the same exit
 * animation instead of disappearing. Whatever a closing must do first — save, revert a preview, attach an
 * indicator — the owner does before `close()`, so only the unmount waits for the animation.
 *
 * A second `close()` while the exit plays is ignored, and `onClosed` is the latest render's callback. The hook
 * belongs in the component that renders the dialog, so its state starts fresh each time the dialog mounts.
 */
export function useModalExit(onClosed: () => void): ModalExit {
  const backdropRef = useRef<HTMLDivElement>(null);
  const { exiting, startExit } = useExitAnimation(backdropRef);
  const closed = useEventCallback(onClosed);
  const close = useCallback(() => startExit(closed), [closed, startExit]);
  return { backdropRef, closing: exiting, close };
}
