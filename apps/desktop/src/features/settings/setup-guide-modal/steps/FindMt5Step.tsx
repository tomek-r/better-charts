import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { useState } from 'react';
import type { Mt5InstallationView } from '../../../../shared/bridge/types';
import { errorText } from '../../../../shared/errorText';
import { GuideError } from '../GuideError';
import { DataFolderChoice } from '../installation/DataFolderChoice';
import { MT5_NOT_FOUND_TEXT } from '../installation/installText';
import type { InstallToMt5View } from '../installation/useInstallToMt5';

/** What the folder picker is doing, and why it refused a file, for the step to show inline. */
interface FolderPick {
  error: string | undefined;
  picking: boolean;
  chooseFolder: () => Promise<void>;
}

/**
 * The native picker for a `terminal64.exe` that detection never looked at. The picked
 * installation joins the list first, so the install uses it straight away.
 */
function useFolderPick(onPicked: (found: Mt5InstallationView[]) => void): FolderPick {
  const [error, setError] = useState<string>();
  const [picking, setPicking] = useState(false);

  async function chooseFolder(): Promise<void> {
    setPicking(true);
    setError(undefined);
    try {
      const startFolder = await invoke<string | null>('mt5_picker_start_folder');
      const picked = await open({
        defaultPath: startFolder ?? undefined,
        multiple: false,
        directory: false,
        filters: [{ name: 'MetaTrader 5 terminal', extensions: ['exe'] }],
      });
      if (picked === null) {
        return;
      }
      onPicked(await invoke<Mt5InstallationView[]>('choose_mt5_installation', { path: picked }));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setPicking(false);
    }
  }

  return { error, picking, chooseFolder };
}

/**
 * Step 1: the installations this machine reports, with their data folders, plus the
 * picker that reaches an MT5 installed anywhere else.
 */
export function FindMt5Step({ view, onNext }: { view: InstallToMt5View; onNext: () => void }) {
  const { shellAvailable, installations, selected, targets, withoutDataFolder, busy, error } = view;
  const pick = useFolderPick(view.adoptInstallations);

  return (
    <section className="setup-guide-step" aria-labelledby="setup-guide-find-title">
      <h3 className="setup-guide-title visually-hidden" id="setup-guide-find-title">
        Find MetaTrader 5
      </h3>
      {installations === undefined && error === undefined && (
        <p className="setup-guide-install-note" role="status">
          Looking for MetaTrader 5…
        </p>
      )}
      {installations === undefined && error !== undefined && <GuideError message={error} />}
      {installations?.length === 0 && <p className="setup-guide-install-note">{MT5_NOT_FOUND_TEXT}</p>}
      {selected !== undefined && (
        <DataFolderChoice targets={targets} selected={selected} disabled={busy} onChoose={view.chooseDataFolder} />
      )}
      {withoutDataFolder.map((installation) => (
        <p className="setup-guide-install-note" key={installation.terminalPath}>
          Start {installation.label} once so it creates its data folder, then reopen this guide.
        </p>
      ))}
      {shellAvailable && (
        <button
          type="button"
          className="setup-guide-secondary setup-guide-choose-folder"
          disabled={pick.picking}
          onClick={() => void pick.chooseFolder()}
        >
          Choose folder…
        </button>
      )}
      {pick.error !== undefined && <GuideError message={pick.error} />}
      <div className="setup-guide-step-actions">
        <button
          type="button"
          className="primary-button setup-guide-action"
          disabled={selected === undefined}
          onClick={onNext}
        >
          Next
        </button>
      </div>
    </section>
  );
}
