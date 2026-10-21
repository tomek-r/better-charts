import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { errorText } from '../../../shared/errorText';
import type {
  Mt5CompiledView,
  Mt5FileReport,
  Mt5InstallationView,
  Mt5InstallFile,
  Mt5InstallOutcome,
  Mt5InstallReport,
} from '../../../shared/bridge/types';

/** The `.mq5` file each report entry names, as it appears in the MT5 folders. */
const FILE_NAMES: Record<Mt5InstallFile, string> = {
  expertAdvisor: 'BetterChartsBridge.mq5',
  indicator: 'BetterChartsTickHistoryReader.mq5',
};

/** What the install step did, in the words the result row shows. */
const OUTCOME_WORDS: Record<Mt5InstallOutcome, string> = {
  installed: 'Installed',
  updated: 'Updated',
  unchanged: 'Already up to date',
};

/** Discovery found nothing: the manual steps below are then the only route. */
const MT5_NOT_FOUND_TEXT = 'MetaTrader 5 was not found on this computer. Use the manual steps below.';

/** One installation paired with one of its data folders: exactly what an install request names. */
interface InstallTarget {
  terminalPath: string;
  label: string;
  mql5Path: string;
}

/** Every installation × data folder pair, in the order the backend listed them. */
function installTargets(installations: Mt5InstallationView[]): InstallTarget[] {
  return installations.flatMap(({ terminalPath, label, dataFolders }) =>
    dataFolders.map((folder) => ({ terminalPath, label, mql5Path: folder.mql5Path })),
  );
}

/** Identifies one target in the folder select; a path holds no line break, so the join is unambiguous. */
function targetKey(target: InstallTarget): string {
  return `${target.terminalPath}\n${target.mql5Path}`;
}

/** The target the folder select currently names, or the first one the backend listed. */
function chooseTarget(targets: InstallTarget[], selectedKey: string | undefined): InstallTarget | undefined {
  return targets.find((target) => targetKey(target) === selectedKey) ?? targets[0];
}

/** Counted noun with its plural, so a compile line reads "1 error" and "2 errors". */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** MetaEditor's summary for one file; a file the run never reached has no result to show. */
function compileText(compiled: Mt5CompiledView | null): string {
  if (!compiled) {
    return 'Not compiled: the indicator has errors';
  }
  if (compiled.errors === 0 && compiled.warnings === 0) {
    return 'Compiled, 0 errors';
  }
  return `${counted(compiled.errors, 'error')}, ${counted(compiled.warnings, 'warning')}`;
}

/** Every file compiled clean: no errors and no warnings left to fix in MetaEditor. */
function everyFileCompiledClean(files: Mt5FileReport[]): boolean {
  return (
    files.length > 0 &&
    files.every((file) => file.compiled !== null && file.compiled.errors === 0 && file.compiled.warnings === 0)
  );
}

/** The data folder the install writes into: plain text for one, a select when there is a choice. */
function DataFolderChoice({
  targets,
  selected,
  disabled,
  onChoose,
}: {
  targets: InstallTarget[];
  selected: InstallTarget;
  disabled: boolean;
  onChoose: (key: string) => void;
}) {
  if (targets.length === 1) {
    return (
      <p className="setup-guide-install-target">
        {selected.label}: <code>{selected.mql5Path}</code>
      </p>
    );
  }
  return (
    <label className="setup-guide-install-field">
      MetaTrader 5 data folder
      <select value={targetKey(selected)} disabled={disabled} onChange={(event) => onChoose(event.target.value)}>
        {targets.map((target) => (
          <option key={targetKey(target)} value={targetKey(target)}>
            {target.label}: {target.mql5Path}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One report entry: the file, what happened to it, and what MetaEditor said about it. */
function FileResultRow({ file }: { file: Mt5FileReport }) {
  return (
    <li className="setup-guide-install-file">
      <span className="setup-guide-install-file-name">{FILE_NAMES[file.file]}</span>
      <span className="setup-guide-install-file-outcome">{OUTCOME_WORDS[file.outcome]}</span>
      <span className="setup-guide-install-file-compile">{compileText(file.compiled)}</span>
      {file.compiled && file.compiled.messages.length > 0 && (
        <ul className="setup-guide-install-messages">
          {file.compiled.messages.map((message, index) => (
            <li key={`${file.file}-${index}`}>{message}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** One row per installed file, then the next step once every file compiled clean. */
function InstallResults({ report }: { report: Mt5InstallReport }) {
  return (
    <div className="setup-guide-install-results">
      <ul className="setup-guide-install-files">
        {report.files.map((file) => (
          <FileResultRow key={file.file} file={file} />
        ))}
      </ul>
      {everyFileCompiledClean(report.files) && (
        <p className="setup-guide-install-done">
          Done. Attach BetterChartsBridge to a chart in MT5 and enable Algo Trading.
        </p>
      )}
    </div>
  );
}

/**
 * Installs both bundled MQL5 files into a data folder the backend discovered, then
 * shows what MetaEditor made of them. Enabling Algo Trading stays with the user: the
 * app never turns it on. The manual steps below remain the fallback when MT5 is not
 * found or an install is refused.
 */
export function InstallToMt5() {
  const shellAvailable = isTauri();
  const [installations, setInstallations] = useState<Mt5InstallationView[]>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Mt5InstallReport>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!shellAvailable) {
      return;
    }
    let mounted = true;
    invoke<Mt5InstallationView[]>('list_mt5_installations')
      .then((found) => {
        if (mounted) {
          setInstallations(found);
        }
      })
      .catch((failure: unknown) => {
        if (mounted) {
          setError(errorText(failure));
        }
      });
    return () => {
      mounted = false;
    };
  }, [shellAvailable]);

  if (!shellAvailable) {
    return null;
  }

  const targets = installations ? installTargets(installations) : [];
  const selected = chooseTarget(targets, selectedKey);
  const withoutDataFolder = (installations ?? []).filter((installation) => installation.dataFolders.length === 0);

  /** A report or refusal belongs to the folder it was asked about, so choosing another one clears it. */
  function chooseDataFolder(key: string) {
    setSelectedKey(key);
    setReport(undefined);
    setError(undefined);
  }

  async function install(target: InstallTarget) {
    if (running) {
      return;
    }
    setRunning(true);
    setError(undefined);
    setReport(undefined);
    try {
      setReport(
        await invoke<Mt5InstallReport>('install_to_mt5', {
          terminalPath: target.terminalPath,
          mql5Path: target.mql5Path,
        }),
      );
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setRunning(false);
    }
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
          <DataFolderChoice targets={targets} selected={selected} disabled={running} onChoose={chooseDataFolder} />
          <button
            type="button"
            className="setup-guide-install-run"
            disabled={running}
            onClick={() => void install(selected)}
          >
            {running ? 'Installing…' : 'Install to MT5'}
          </button>
          <p className="setup-guide-install-note">
            If the EA is attached to a chart, MT5 reloads it and the bridge reconnects. Install is refused while an
            order is being sent.
          </p>
          {error !== undefined && (
            <p className="setup-guide-install-error" role="alert">
              {error}
            </p>
          )}
          {report && <InstallResults report={report} />}
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
