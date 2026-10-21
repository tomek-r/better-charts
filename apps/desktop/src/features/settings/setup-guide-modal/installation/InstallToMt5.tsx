import { DataFolderChoice } from './DataFolderChoice';
import { InstallResults } from './InstallResults';
import { MT5_NOT_FOUND_TEXT } from './installText';
import { RestartWithEa } from './RestartWithEa';
import { useInstallToMt5 } from './useInstallToMt5';

/**
 * Installs both bundled MQL5 files into a data folder the backend discovered, then
 * shows what MetaEditor made of them. Enabling Algo Trading stays with the user: the
 * app never turns it on. The manual steps below remain the fallback when MT5 is not
 * found or an install is refused.
 *
 * A run that compiled everything clean reports one short line beside the button, in
 * the row the button already occupies, so the dialog keeps its height; anything left
 * to fix keeps the detailed rows below. That line words the next step from what
 * happened to the EA and from the connection the press found.
 *
 * Where that line offers a restart, the phrase is a button that asks first: the
 * confirmation, the progress line and the result all replace the line inside the same
 * reserved row, and only the confirmed press reaches the backend.
 */
export function InstallToMt5() {
  const {
    shellAvailable,
    installations,
    targets,
    selected,
    withoutDataFolder,
    report,
    cleanReport,
    doneLine,
    installedTarget,
    running,
    restartStep,
    busy,
    error,
    restartLink,
    restartConfirm,
    chooseDataFolder,
    install,
    restart,
    cancelRestart,
    openRestart,
  } = useInstallToMt5();

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
              {running ? 'Installing…' : 'Install to MT5'}
            </button>
            {cleanReport !== undefined && doneLine !== undefined && installedTarget !== undefined && (
              <RestartWithEa
                files={cleanReport.files}
                doneLine={doneLine}
                restartStep={restartStep}
                linkRef={restartLink}
                confirmRef={restartConfirm}
                onOpen={openRestart}
                onConfirm={() => void restart(installedTarget)}
                onCancel={cancelRestart}
              />
            )}
          </div>
          <p className="setup-guide-install-note">
            If the EA is attached to a chart, MT5 reloads it and the bridge reconnects. Install is refused while an
            order is being sent.
          </p>
          {error !== undefined && (
            <p className="setup-guide-install-error" role="alert">
              {error}
            </p>
          )}
          {report !== undefined && cleanReport === undefined && <InstallResults report={report} />}
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
