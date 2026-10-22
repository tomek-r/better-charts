import { useCallback, useEffect, useRef, useState } from 'react';
import { afterExitAnimation } from '../../shared/ui/afterExitAnimation';
import { useAppSettingsView } from './AppSettingsProvider';
import { SetupCompleteIcon } from './SetupCompleteIcon';

/** How long the window stays in front before the entrance plays, so the user has settled on it first. */
const FRONT_ENTRANCE_DELAY_MS = 500;

/**
 * The finished screen usually appears while the user is still in MetaTrader 5, so its entrance waits
 * for the Better Charts window to come to the front, plus a short settle delay, and then plays with
 * the user watching. Leaving the window again within that delay cancels the entrance. Once the
 * window has been in front the entrance has played, so the answer never goes back to false.
 */
function useWindowInFront(): boolean {
  const [inFront, setInFront] = useState(() => document.hasFocus());

  useEffect(() => {
    if (inFront) {
      return;
    }
    let settleTimer: number | undefined;
    const cancelSettleTimer = () => window.clearTimeout(settleTimer);
    const markWindowInFront = () => {
      cancelSettleTimer();
      settleTimer = window.setTimeout(() => setInFront(true), FRONT_ENTRANCE_DELAY_MS);
    };
    window.addEventListener('focus', markWindowInFront);
    window.addEventListener('blur', cancelSettleTimer);
    return () => {
      window.removeEventListener('focus', markWindowInFront);
      window.removeEventListener('blur', cancelSettleTimer);
      cancelSettleTimer();
    };
  }, [inFront]);

  return inFront;
}

function SetupCompleteDialog() {
  const { setupCompleteOverSetupScreen, isOpen, dismissSetupComplete } = useAppSettingsView();
  const windowInFront = useWindowInFront();
  const happyTradingButton = useRef<HTMLButtonElement>(null);
  const screenRoot = useRef<HTMLDivElement>(null);
  const leavingRef = useRef(false);
  const [leaving, setLeaving] = useState(false);

  // The screen fades out on its own and only leaves the workspace once it is gone; the guard keeps
  // a held Escape or a double click from starting that exit twice.
  const leave = useCallback(() => {
    if (leavingRef.current) {
      return;
    }
    leavingRef.current = true;
    setLeaving(true);
    afterExitAnimation(screenRoot.current, dismissSetupComplete);
  }, [dismissSetupComplete]);

  // The settings dialog below plays its exit animation after this screen mounts and hands focus
  // back to its own trigger as it unmounts, so the screen claims the focus once that dialog is gone.
  useEffect(() => {
    happyTradingButton.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      leave();
    };
    window.addEventListener('keydown', dismissOnEscape, true);
    return () => window.removeEventListener('keydown', dismissOnEscape, true);
  }, [leave]);

  const overSetupScreenClass = setupCompleteOverSetupScreen ? ' setup-complete-over-screen' : '';
  const awaitingFrontClass = windowInFront ? '' : ' is-awaiting-front';
  const leavingClass = leaving ? ' is-leaving' : '';
  return (
    <div
      ref={screenRoot}
      className={`bridge-setup-screen setup-complete-screen${overSetupScreenClass}${awaitingFrontClass}${leavingClass}`}
      role="dialog"
      aria-modal="true"
      aria-label="Setup complete"
    >
      <div className="bridge-setup-screen-content setup-complete-content">
        <SetupCompleteIcon />
        <button
          ref={happyTradingButton}
          type="button"
          className="modal-dialog-button primary"
          autoFocus
          onClick={leave}
        >
          Happy trading
        </button>
      </div>
    </div>
  );
}

/**
 * The bridge answered while the guide was open: the workspace waits blurred behind the finished
 * screen, whose button takes the screen away and leaves the chart.
 */
export function SetupCompleteScreen() {
  const { setupCompleteShown } = useAppSettingsView();
  if (!setupCompleteShown) {
    return null;
  }
  // Mounting the dialog per showing gives every showing a fresh exit state.
  return <SetupCompleteDialog />;
}
