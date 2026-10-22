import { useEffect, useRef } from 'react';
import { useAppSettingsView } from './AppSettingsProvider';
import { SetupCompleteIcon } from './SetupCompleteIcon';

/**
 * The bridge answered while the guide was open: the workspace waits blurred behind the finished
 * screen, whose button takes the screen away and leaves the chart.
 */
export function SetupCompleteScreen() {
  const { setupCompleteShown, isOpen, dismissSetupComplete } = useAppSettingsView();
  const happyTradingButton = useRef<HTMLButtonElement>(null);

  // The settings dialog below plays its exit animation after this screen mounts and hands focus
  // back to its own trigger as it unmounts, so the screen claims the focus once that dialog is gone.
  useEffect(() => {
    if (setupCompleteShown) {
      happyTradingButton.current?.focus();
    }
  }, [isOpen, setupCompleteShown]);

  useEffect(() => {
    if (!setupCompleteShown) {
      return;
    }
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      dismissSetupComplete();
    };
    window.addEventListener('keydown', dismissOnEscape, true);
    return () => window.removeEventListener('keydown', dismissOnEscape, true);
  }, [dismissSetupComplete, setupCompleteShown]);

  if (!setupCompleteShown) {
    return null;
  }
  return (
    <div className="bridge-setup-screen" role="dialog" aria-modal="true" aria-label="Setup complete">
      <div className="bridge-setup-screen-content setup-complete-content">
        <SetupCompleteIcon />
        <button
          ref={happyTradingButton}
          type="button"
          className="modal-dialog-button primary"
          autoFocus
          onClick={dismissSetupComplete}
        >
          Happy trading
        </button>
      </div>
    </div>
  );
}
