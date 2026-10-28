import { useCallback, useEffect, useRef, useState } from 'react';
import { useExitAnimation } from '../../../shared/hooks/useExitAnimation';
import {
  useAppSettingsActions,
  useSettingsDialogOpen,
  useSetupCompleteOverSetupScreen,
  useSetupCompleteShown,
} from '../AppSettingsProvider';
import { SetupCompleteIcon } from './SetupCompleteIcon';

type WindowFront = {
  inFront: boolean;
  /** The screen mounted while the window was behind, so its entrance waited for the front. */
  enteredBehind: boolean;
};

/**
 * The finished screen usually appears while the user is still in MetaTrader 5, so its entrance waits
 * for the Better Charts window to come to the front; CSS then holds it a further moment, so the user
 * has settled on the window before it plays. Once the window has been in front the entrance has
 * played, so the answer never goes back to false.
 */
function useWindowInFront(): WindowFront {
  const [windowFront, setWindowFront] = useState<WindowFront>(() => {
    const inFront = document.hasFocus();
    return { inFront, enteredBehind: !inFront };
  });

  useEffect(() => {
    if (windowFront.inFront) {
      return;
    }
    const markWindowInFront = () => setWindowFront((current) => ({ ...current, inFront: true }));
    window.addEventListener('focus', markWindowInFront);
    return () => window.removeEventListener('focus', markWindowInFront);
  }, [windowFront.inFront]);

  return windowFront;
}

/** Holds the entrance while the window is behind, then lets CSS add the settle time once it is in front. */
function entranceFrontClass({ inFront, enteredBehind }: WindowFront): string {
  if (!inFront) {
    return ' is-awaiting-front';
  }
  return enteredBehind ? ' is-returning-to-front' : '';
}

function SetupCompleteDialog() {
  const setupCompleteOverSetupScreen = useSetupCompleteOverSetupScreen();
  const isOpen = useSettingsDialogOpen();
  const { dismissSetupComplete } = useAppSettingsActions();
  const windowFront = useWindowInFront();
  const happyTradingButton = useRef<HTMLButtonElement>(null);
  const screenRoot = useRef<HTMLDivElement>(null);
  const { exiting: leaving, startExit } = useExitAnimation(screenRoot);

  // The screen fades out on its own and only leaves the workspace once it is gone.
  const leave = useCallback(() => startExit(dismissSetupComplete), [dismissSetupComplete, startExit]);

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
  const frontClass = entranceFrontClass(windowFront);
  const leavingClass = leaving ? ' is-leaving' : '';
  return (
    <div
      ref={screenRoot}
      className={`bridge-screen setup-complete-screen${overSetupScreenClass}${frontClass}${leavingClass}`}
      role="dialog"
      aria-modal="true"
      aria-label="Setup complete"
    >
      <div className="bridge-screen-content setup-complete-content">
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
  const setupCompleteShown = useSetupCompleteShown();
  if (!setupCompleteShown) {
    return null;
  }
  // Mounting the dialog per showing gives every showing a fresh exit state.
  return <SetupCompleteDialog />;
}
