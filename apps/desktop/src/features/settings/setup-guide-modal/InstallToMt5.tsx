import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { errorText } from '../../../shared/errorText';
import { useBridgeConnectionSelector } from '../../bridge/BridgeSessionProvider';
import type {
  Mt5CompiledView,
  Mt5FileReport,
  Mt5InstallationView,
  Mt5InstallFile,
  Mt5InstallOutcome,
  Mt5InstallReport,
  Mt5RestartReport,
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

/** The words of a done line that open the restart confirmation; the line's one clickable part. */
const RESTART_PHRASE = 'restart MT5 with the EA attached';

/**
 * A done line that ends on the restart phrase, so a line can never drift from the
 * words it turns into a button.
 */
function restartLine(lead: string): string {
  return `${lead}${RESTART_PHRASE}.`;
}

/** A first install leaves the EA off every chart, so the success line names both routes to a connection. */
const FIRST_INSTALL_DONE_TEXT = restartLine(
  'Installed and compiled. Drag BetterChartsBridge onto a chart in MT5 and enter the token, or ',
);

/** An updated EA that a live bridge is attached to: MT5 reloads it and the link returns by itself. */
const RECONNECT_DONE_TEXT = 'Installed and compiled. MT5 reloads the EA and the bridge reconnects.';

/** An updated EA with no bridge: nothing reloads it, so the user has to reattach it. */
const REATTACH_DONE_TEXT = restartLine('Installed and compiled. Reattach BetterChartsBridge in MT5. Or ');

/** Asked before anything closes: the restart takes MT5 down, so it never starts on a single click. */
const RESTART_CONFIRM_TEXT = 'MT5 will close and reopen with the EA attached.';

/** The restart is under way and the dialog can do nothing else until the backend answers. */
const RESTART_RUNNING_TEXT = 'Restarting MT5…';

/** The restart succeeded. Algo Trading is the terminal's own switch, so it stays with the user. */
const RESTART_DONE_TEXT = 'MT5 is restarting with the EA attached. Enable Algo Trading in MT5 if it is off.';

/** One installation paired with one of its data folders: exactly what an install request names. */
interface InstallTarget {
  terminalPath: string;
  label: string;
  mql5Path: string;
}

/**
 * Where the done line stands within its optional restart. Only `idle` shows the line
 * itself; every other step replaces it in the same reserved row, so the dialog keeps
 * its height.
 */
type RestartStep = 'idle' | 'confirm' | 'running' | 'done';

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

/** What each file became, as the success line's tooltip spells it out. */
function outcomeSummary(files: Mt5FileReport[]): string {
  return files.map((file) => `${FILE_NAMES[file.file]} ${OUTCOME_WORDS[file.outcome].toLowerCase()}`).join(', ');
}

/**
 * The success line of a clean report, from what happened to the EA and whether a
 * bridge was connected when Install was pressed: a first install has no attached EA
 * to reload, and an update only comes back by itself while a bridge is live.
 */
function installDoneText(files: Mt5FileReport[], bridgeConnected: boolean): string {
  if (files.some((file) => file.file === 'expertAdvisor' && file.outcome === 'installed')) {
    return FIRST_INSTALL_DONE_TEXT;
  }
  return bridgeConnected ? RECONNECT_DONE_TEXT : REATTACH_DONE_TEXT;
}

/**
 * A done line split around its restart phrase: `lead` and `trail` stay plain text.
 * The reconnect line has no phrase, so it has nothing to click and stays text only.
 */
function splitAtRestartPhrase(text: string): { lead: string; trail: string } | undefined {
  const at = text.indexOf(RESTART_PHRASE);
  return at === -1 ? undefined : { lead: text.slice(0, at), trail: text.slice(at + RESTART_PHRASE.length) };
}

/** The restart phrase as a button: styled like a link, it only opens the confirmation. */
function RestartLink({ linkRef, onOpen }: { linkRef: RefObject<HTMLButtonElement | null>; onOpen: () => void }) {
  return (
    <button ref={linkRef} type="button" className="setup-guide-install-restart" onClick={onOpen}>
      {RESTART_PHRASE}
    </button>
  );
}

/** One settled done line: its sentence, with the restart phrase as the only clickable words. */
function DoneLineText({
  text,
  linkRef,
  onOpen,
}: {
  text: string;
  linkRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
}) {
  const parts = splitAtRestartPhrase(text);
  if (parts === undefined) {
    return <>{text}</>;
  }
  return (
    <>
      {parts.lead}
      <RestartLink linkRef={linkRef} onOpen={onOpen} />
      {parts.trail}
    </>
  );
}

/** The confirmation that replaces the done line, in the row it already reserved. */
function RestartConfirmation({
  confirmRef,
  onConfirm,
  onCancel,
}: {
  confirmRef: RefObject<HTMLButtonElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <span className="setup-guide-install-confirm-text">{RESTART_CONFIRM_TEXT}</span>
      <button ref={confirmRef} type="button" className="setup-guide-install-confirm" onClick={onConfirm}>
        Restart MT5
      </button>
      <button type="button" className="setup-guide-install-confirm" onClick={onCancel}>
        Cancel
      </button>
    </>
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

/** One row per file, shown only when a diagnostic or an uncompiled file needs attention. */
function InstallResults({ report }: { report: Mt5InstallReport }) {
  return (
    <div className="setup-guide-install-results">
      <ul className="setup-guide-install-files">
        {report.files.map((file) => (
          <FileResultRow key={file.file} file={file} />
        ))}
      </ul>
    </div>
  );
}

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
  const shellAvailable = isTauri();
  const bridgeConnected = useBridgeConnectionSelector(({ status }) => status.state === 'connected');
  const [installations, setInstallations] = useState<Mt5InstallationView[]>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Mt5InstallReport>();
  /** The folder the report came from: a restart names the target the install wrote into. */
  const [installedTarget, setInstalledTarget] = useState<InstallTarget>();
  // Captured with the press: the install itself drops the connection while MT5 reloads the EA.
  const [connectedAtInstall, setConnectedAtInstall] = useState(false);
  const [restartStep, setRestartStep] = useState<RestartStep>('idle');
  const [error, setError] = useState<string>();
  const restartLink = useRef<HTMLButtonElement>(null);
  const restartConfirm = useRef<HTMLButtonElement>(null);
  // Set by Cancel, so the effect below knows the link is back and may take focus again.
  const refocusLink = useRef(false);

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

  // A confirmation takes focus as soon as it exists, so a keyboard user confirms or cancels at once.
  useEffect(() => {
    if (restartStep === 'confirm') {
      restartConfirm.current?.focus();
    } else if (restartStep === 'idle' && refocusLink.current) {
      refocusLink.current = false;
      restartLink.current?.focus();
    }
  }, [restartStep]);

  if (!shellAvailable) {
    return null;
  }

  const targets = installations ? installTargets(installations) : [];
  const selected = chooseTarget(targets, selectedKey);
  const withoutDataFolder = (installations ?? []).filter((installation) => installation.dataFolders.length === 0);
  // Success has its own one-line report; every other outcome keeps the detailed rows.
  const cleanReport = report !== undefined && everyFileCompiledClean(report.files) ? report : undefined;
  const doneLine = cleanReport === undefined ? undefined : installDoneText(cleanReport.files, connectedAtInstall);
  const restarting = restartStep === 'running';
  // One target at a time: the install and the restart both own the terminal while they run.
  const busy = running || restarting;

  /** A report or refusal belongs to the folder it was asked about, so choosing another one clears it. */
  function chooseDataFolder(key: string) {
    setSelectedKey(key);
    setReport(undefined);
    setInstalledTarget(undefined);
    setRestartStep('idle');
    setError(undefined);
  }

  async function install(target: InstallTarget) {
    if (busy) {
      return;
    }
    setRunning(true);
    setError(undefined);
    setReport(undefined);
    setInstalledTarget(target);
    setRestartStep('idle');
    setConnectedAtInstall(bridgeConnected);
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

  /**
   * The confirmed restart: MT5 closes, so the row reports progress until the backend
   * answers. A refusal leaves the terminal as it was, which brings the line back with
   * the reason in the alert below.
   */
  async function restart(target: InstallTarget) {
    setRestartStep('running');
    setError(undefined);
    try {
      await invoke<Mt5RestartReport>('restart_mt5_with_ea', {
        terminalPath: target.terminalPath,
        mql5Path: target.mql5Path,
      });
      setRestartStep('done');
    } catch (failure) {
      setError(errorText(failure));
      setRestartStep('idle');
    }
  }

  function cancelRestart() {
    refocusLink.current = true;
    setRestartStep('idle');
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
              <p
                className={`setup-guide-install-done${restartStep === 'confirm' ? ' is-confirming' : ''}`}
                title={restartStep === 'idle' ? `${doneLine} ${outcomeSummary(cleanReport.files)}` : undefined}
              >
                {restartStep === 'idle' && (
                  <DoneLineText text={doneLine} linkRef={restartLink} onOpen={() => setRestartStep('confirm')} />
                )}
                {restartStep === 'confirm' && (
                  <RestartConfirmation
                    confirmRef={restartConfirm}
                    onConfirm={() => void restart(installedTarget)}
                    onCancel={cancelRestart}
                  />
                )}
                {restarting && <span role="status">{RESTART_RUNNING_TEXT}</span>}
                {restartStep === 'done' && RESTART_DONE_TEXT}
              </p>
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
