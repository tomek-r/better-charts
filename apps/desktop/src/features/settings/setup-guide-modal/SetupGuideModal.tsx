import { useCallback, useEffect, useRef, useState } from 'react';
import { afterExitAnimation } from '../../../shared/ui/afterExitAnimation';
import { useAppSettingsView } from '../AppSettingsProvider';
import { SetupGuideStep } from '../useAppSettings';
import { useInstallToMt5 } from './installation/useInstallToMt5';
import { ConnectStep } from './steps/ConnectStep';
import { FindMt5Step } from './steps/FindMt5Step';
import { InstallStep } from './steps/InstallStep';

import './setup-guide-modal.css';

/** The three steps in order, named the way the indicator and their headings name them. */
const GUIDE_STEPS: { step: SetupGuideStep; name: string }[] = [
  { step: SetupGuideStep.Find, name: 'Find MetaTrader 5' },
  { step: SetupGuideStep.Install, name: 'Install' },
  { step: SetupGuideStep.Connect, name: 'Connect' },
];

/** Where Back goes from a step: nothing before the first one, so it shows no way back. */
const PREVIOUS_STEP: Partial<Record<SetupGuideStep, SetupGuideStep>> = {
  [SetupGuideStep.Install]: SetupGuideStep.Find,
  [SetupGuideStep.Connect]: SetupGuideStep.Install,
};

/** Where the guide stands: the current step carries `aria-current`, the others only their name. */
function StepIndicator({ current }: { current: SetupGuideStep }) {
  return (
    <ol className="setup-guide-progress" aria-label="Setup steps">
      {GUIDE_STEPS.map(({ step, name }) => (
        <li key={step} aria-current={step === current ? 'step' : undefined}>
          {name}
        </li>
      ))}
    </ol>
  );
}

/**
 * A simple overlay that sits on top of the open settings content, or over the whole window when
 * standalone. It walks three steps — find MT5, install the EA, wait for the connection — and keeps
 * the install state across them, so going back never repeats the discovery.
 */
export function SetupGuideModal({
  onClose,
  onFinished,
  finishing,
  standalone,
}: {
  onClose: () => void;
  /** The setup completed: the exit animation announced by `finishing` has ended. */
  onFinished: () => void;
  /** The setup completed: the guide fades out slowly and only then goes. */
  finishing: boolean;
  /** No settings dialog below, so the guide owns the window instead of sitting inside it. */
  standalone?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const { setupGuideStep, showSetupGuideStep } = useAppSettingsView();
  const previousStep = PREVIOUS_STEP[setupGuideStep];
  const goBack = useCallback(() => {
    if (previousStep !== undefined) {
      showSetupGuideStep(previousStep);
    }
  }, [previousStep, showSetupGuideStep]);
  const showInstallStep = useCallback(() => showSetupGuideStep(SetupGuideStep.Install), [showSetupGuideStep]);
  const finishInstall = useCallback(() => showSetupGuideStep(SetupGuideStep.Connect), [showSetupGuideStep]);
  const install = useInstallToMt5(finishInstall);
  const playExit = useCallback((afterExit: () => void) => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    setClosing(true);
    afterExitAnimation(backdrop.current, afterExit);
  }, []);
  const requestClose = useCallback(() => playExit(onClose), [onClose, playExit]);
  // A completed setup takes the same exit route as a manual close, only slower and without asking
  // the store for it: the store unmounts the guide once this fade's `animationend` arrives.
  useEffect(() => {
    if (finishing) {
      playExit(onFinished);
    }
  }, [finishing, onFinished, playExit]);
  const backdropClassName = `setup-guide-backdrop${standalone ? ' setup-guide-backdrop-standalone' : ''}${
    closing ? ' is-closing' : ''
  }${finishing ? ' is-finishing' : ''}`;

  useEffect(() => {
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [requestClose]);

  return (
    <div ref={backdrop} className={backdropClassName}>
      <div
        ref={dialog}
        className="setup-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-guide-title"
        data-setup-guide
        tabIndex={-1}
      >
        <div className="setup-guide-header">
          <h2 id="setup-guide-title">Set up the MT5 bridge</h2>
          <button type="button" className="setup-guide-close" onClick={requestClose} aria-label="Close setup guide">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
              <path
                d="M5.2 5.2l7.6 7.6M12.8 5.2L5.2 12.8"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </div>

        <div className="setup-guide-body">
          <div className="setup-guide-progress-row">
            <StepIndicator current={setupGuideStep} />
            {previousStep !== undefined && (
              <button type="button" className="setup-guide-secondary setup-guide-back" onClick={goBack}>
                Back
              </button>
            )}
          </div>
          {setupGuideStep === SetupGuideStep.Find && <FindMt5Step view={install} onNext={showInstallStep} />}
          {setupGuideStep === SetupGuideStep.Install && <InstallStep view={install} />}
          {setupGuideStep === SetupGuideStep.Connect && <ConnectStep />}
        </div>
      </div>
    </div>
  );
}
