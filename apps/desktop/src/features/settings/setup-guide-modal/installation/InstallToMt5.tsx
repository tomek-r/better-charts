import { useAppSettingsView } from '../../AppSettingsProvider';
import { DataFolderChoice } from './DataFolderChoice';
import { InstallResults } from './InstallResults';
import { INSTALLING_TEXT, MT5_NOT_FOUND_TEXT, RESTARTING_TEXT } from './installText';
import type { InstallTarget } from './installTargets';
import { useInstallToMt5, type InstallButton, type InstallToMt5View } from './useInstallToMt5';

/** The one press a clean plain install leaves: it finishes the setup the way a clean restart does. */
const ALL_INSTALLED_TEXT = 'All installed. Close';

/** The running button names its step; the idle one keeps its own label. */
function installButtonText(pressed: InstallButton | undefined): string {
  return pressed === 'install' ? INSTALLING_TEXT : 'Install to MT5';
}

/** A restart press passes through two steps, so this button has two names to report. */
function restartButtonText(pressed: InstallButton | undefined, restarting: boolean): string {
  if (pressed !== 'installAndRestart') {
    return 'Install and restart MT5';
  }
  return restarting ? RESTARTING_TEXT : INSTALLING_TEXT;
}

/** What the actions row renders from: the folder to install into, the section state and how to close. */
interface InstallActionsProps {
  view: InstallToMt5View;
  target: InstallTarget;
  onClose: () => void;
}

/**
 * The buttons under the folder: a clean plain install has nothing left to ask, so one press
 * closes the setup; otherwise both presses stay, with the note that explains the restart.
 */
function InstallActions({ view, target, onClose }: InstallActionsProps) {
  if (view.installedClean) {
    return (
      <div className="setup-guide-install-actions">
        <button type="button" className="setup-guide-install-run" onClick={onClose}>
          {ALL_INSTALLED_TEXT}
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="setup-guide-install-actions">
        <button
          type="button"
          className="setup-guide-install-run"
          disabled={view.busy}
          onClick={() => void view.install(target)}
        >
          {installButtonText(view.pressed)}
        </button>
        <button
          type="button"
          className="setup-guide-install-run"
          disabled={view.busy}
          onClick={() => void view.installAndRestart(target)}
        >
          {restartButtonText(view.pressed, view.restarting)}
        </button>
      </div>
      <p className="setup-guide-install-note">
        Install and restart MT5 reopens MT5 with the EA attached. Not available while an order is being sent.
      </p>
    </>
  );
}

/**
 * Installs both bundled MQL5 files into a data folder the backend discovered, and on a
 * second button installs and then restarts MT5 with the EA attached. Enabling Algo
 * Trading stays with the user: the app never turns it on. The manual steps below remain
 * the fallback when MT5 is not found or an install is refused.
 *
 * A refusal and a report with something to fix are the only outcomes worth rows or words.
 * A clean plain install instead ends on one closing button, which finishes the setup
 * exactly as a clean install and restart does.
 */
export function InstallToMt5() {
  const { completeSetup } = useAppSettingsView();
  const view = useInstallToMt5(completeSetup);
  const { shellAvailable, installations, targets, selected, withoutDataFolder, results, error } = view;

  if (!shellAvailable) {
    return null;
  }

  return (
    <section className="setup-guide-install" aria-labelledby="setup-guide-install-title">
      <h3 className="setup-guide-title" id="setup-guide-install-title">
        Install automatically
      </h3>
      {installations === undefined && error === undefined && (
        <p className="setup-guide-install-note" role="status">
          Looking for MetaTrader 5…
        </p>
      )}
      {installations === undefined && error !== undefined && (
        <p className="setup-guide-install-error" role="alert">
          {error}
        </p>
      )}
      {installations !== undefined && installations.length === 0 && (
        <p className="setup-guide-install-note">{MT5_NOT_FOUND_TEXT}</p>
      )}
      {selected !== undefined && (
        <>
          <DataFolderChoice
            targets={targets}
            selected={selected}
            disabled={view.busy}
            onChoose={view.chooseDataFolder}
          />
          <InstallActions view={view} target={selected} onClose={completeSetup} />
          {error !== undefined && (
            <p className="setup-guide-install-error" role="alert">
              {error}
            </p>
          )}
          {results !== undefined && <InstallResults report={results} />}
        </>
      )}
      {withoutDataFolder.map((installation) => (
        <p className="setup-guide-install-note" key={installation.terminalPath}>
          Start {installation.label} once so it creates its data folder, then reopen this guide.
        </p>
      ))}
    </section>
  );
}
