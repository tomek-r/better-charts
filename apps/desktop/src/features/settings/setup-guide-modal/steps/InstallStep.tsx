import { GuideError } from '../GuideError';
import { InstallResults } from '../installation/InstallResults';
import { INSTALLING_TEXT, RESTARTING_TEXT } from '../installation/installText';
import type { InstallButton, InstallToMt5View } from '../installation/useInstallToMt5';
import { ManualInstall } from '../ManualInstall';

/** The running button names its step; the idle one keeps its own label. */
function installButtonText(pressed: InstallButton | undefined): string {
  return pressed === 'install' ? INSTALLING_TEXT : 'Install only';
}

/** A restart press passes through two steps, so this button has two names to report. */
function restartButtonText(pressed: InstallButton | undefined, restarting: boolean): string {
  if (pressed !== 'installAndRestart') {
    return 'Install and restart MT5';
  }
  return restarting ? RESTARTING_TEXT : INSTALLING_TEXT;
}

/**
 * Step 2: the automatic install into the folder step 1 chose, with the manual route
 * folded away below it. A refusal and a report with something to fix stay here as
 * inline rows; a clean run hands the guide on to the connection step.
 */
export function InstallStep({ view }: { view: InstallToMt5View }) {
  const { selected, busy, pressed, restarting, error, results } = view;
  const installUnavailable = selected === undefined || busy;

  return (
    <section className="setup-guide-step" aria-labelledby="setup-guide-install-title">
      <h3 className="setup-guide-title" id="setup-guide-install-title">
        Install
      </h3>
      <p className="setup-guide-install-note">
        Installs both bundled MQL5 files into the chosen data folder and compiles them with MetaEditor.
      </p>
      <div className="setup-guide-install-actions">
        <button
          type="button"
          className="primary-button setup-guide-install-run"
          disabled={installUnavailable}
          onClick={() => {
            if (selected !== undefined) {
              void view.installAndRestart(selected);
            }
          }}
        >
          {restartButtonText(pressed, restarting)}
        </button>
        <button
          type="button"
          className="setup-guide-install-run setup-guide-secondary"
          disabled={installUnavailable}
          onClick={() => {
            if (selected !== undefined) {
              void view.install(selected);
            }
          }}
        >
          {installButtonText(pressed)}
        </button>
      </div>
      {error !== undefined && <GuideError message={error} />}
      {results !== undefined && <InstallResults report={results} />}
      <ManualInstall />
    </section>
  );
}
