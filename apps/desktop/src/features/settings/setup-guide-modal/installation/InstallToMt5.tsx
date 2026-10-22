import { useAppSettingsView } from '../../AppSettingsProvider';
import { DataFolderChoice } from './DataFolderChoice';
import { InstallResults } from './InstallResults';
import { INSTALLING_TEXT, MT5_NOT_FOUND_TEXT, RESTARTING_TEXT } from './installText';
import { useInstallToMt5, type InstallButton } from './useInstallToMt5';

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

/**
 * Installs both bundled MQL5 files into a data folder the backend discovered, and on a
 * second button installs and then restarts MT5 with the EA attached. Enabling Algo
 * Trading stays with the user: the app never turns it on. The manual steps below remain
 * the fallback when MT5 is not found or an install is refused.
 *
 * A clean run renders nothing: the buttons return to their labels, since a refusal and
 * a report with something to fix are the only outcomes worth words.
 */
export function InstallToMt5() {
  const { completeSetup } = useAppSettingsView();
  const {
    shellAvailable,
    installations,
    targets,
    selected,
    withoutDataFolder,
    results,
    pressed,
    restarting,
    busy,
    error,
    chooseDataFolder,
    install,
    installAndRestart,
  } = useInstallToMt5(completeSetup);

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
          <DataFolderChoice targets={targets} selected={selected} disabled={busy} onChoose={chooseDataFolder} />
          <div className="setup-guide-install-actions">
            <button
              type="button"
              className="setup-guide-install-run"
              disabled={busy}
              onClick={() => void install(selected)}
            >
              {installButtonText(pressed)}
            </button>
            <button
              type="button"
              className="setup-guide-install-run"
              disabled={busy}
              onClick={() => void installAndRestart(selected)}
            >
              {restartButtonText(pressed, restarting)}
            </button>
          </div>
          <p className="setup-guide-install-note">
            Install and restart MT5 reopens MT5 with the EA attached. Not available while an order is being sent.
          </p>
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
