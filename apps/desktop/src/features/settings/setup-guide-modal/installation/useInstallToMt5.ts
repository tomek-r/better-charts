import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { errorText } from '../../../../shared/errorText';
import type { Mt5InstallationView, Mt5InstallReport, Mt5RestartReport } from '../../../../shared/bridge/types';
import { chooseTarget, installTargets, type InstallTarget } from './installTargets';
import { everyFileCompiledClean } from './installText';

/** The two presses the guide offers: the plain install, and the install that then restarts MT5. */
export type InstallButton = 'install' | 'installAndRestart';

/** The call in flight: which button started it, and whether it has reached the restart. */
interface InstallRun {
  button: InstallButton;
  restarting: boolean;
}

/** Everything the install steps render: the folders, the step in flight and the last report. */
export interface InstallToMt5View {
  shellAvailable: boolean;
  installations: Mt5InstallationView[] | undefined;
  targets: InstallTarget[];
  selected: InstallTarget | undefined;
  withoutDataFolder: Mt5InstallationView[];
  results: Mt5InstallReport | undefined;
  pressed: InstallButton | undefined;
  restarting: boolean;
  busy: boolean;
  error: string | undefined;
  chooseDataFolder: (key: string) => void;
  adoptInstallations: (found: Mt5InstallationView[]) => void;
  /** Both presses install into the selected folder; without a selection they do nothing. */
  install: () => Promise<void>;
  installAndRestart: () => Promise<void>;
}

/** Both commands name the same folder: the install writes it and the restart reopens that terminal on it. */
function targetArgs(target: InstallTarget): { terminalPath: string; mql5Path: string } {
  return { terminalPath: target.terminalPath, mql5Path: target.mql5Path };
}

/**
 * The install state, kept by the guide rather than by one of its steps so the folders,
 * the selection and the last report survive moving between them. The list, install and
 * restart commands are its only ways to reach the backend. `onCleanInstall` runs once
 * either button has left nothing to fix: the guide then asks for the connection.
 */
export function useInstallToMt5(onCleanInstall: () => void): InstallToMt5View {
  const shellAvailable = isTauri();
  const [installations, setInstallations] = useState<Mt5InstallationView[]>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [run, setRun] = useState<InstallRun>();
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

  const targets = installations ? installTargets(installations) : [];
  const selected = chooseTarget(targets, selectedKey);
  const withoutDataFolder = (installations ?? []).filter((installation) => installation.dataFolders.length === 0);
  // A clean run says nothing and shows no rows; anything left to fix keeps the detailed rows below the buttons.
  const results = report !== undefined && everyFileCompiledClean(report.files) ? undefined : report;

  /** A report or refusal belongs to the folder it was asked about, so choosing another one clears it. */
  function chooseDataFolder(key: string) {
    setSelectedKey(key);
    setReport(undefined);
    setError(undefined);
  }

  /** The list a folder pick produced: the picked installation comes first, so it is the selected one. */
  function adoptInstallations(found: Mt5InstallationView[]) {
    setInstallations(found);
    setSelectedKey(undefined);
    setReport(undefined);
    setError(undefined);
  }

  /**
   * One press installs both files; the restart button adds the restart once every
   * file compiled clean. A report with something to fix ends the run there, so the
   * rows can say what; a refusal leaves the terminal as it was, with only the error.
   * A clean run of either button hands the guide on to the connection step. Without
   * a selected folder there is nothing to install into, so the press does nothing.
   */
  async function runInstall(button: InstallButton): Promise<void> {
    if (run !== undefined || selected === undefined) {
      return;
    }
    setRun({ button, restarting: false });
    setError(undefined);
    setReport(undefined);
    try {
      const installed = await invoke<Mt5InstallReport>('install_to_mt5', targetArgs(selected));
      setReport(installed);
      if (!everyFileCompiledClean(installed.files)) {
        return;
      }
      if (button === 'install') {
        onCleanInstall();
        return;
      }
      setRun({ button, restarting: true });
      await invoke<Mt5RestartReport>('restart_mt5_with_ea', targetArgs(selected));
      onCleanInstall();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setRun(undefined);
    }
  }

  return {
    shellAvailable,
    installations,
    targets,
    selected,
    withoutDataFolder,
    results,
    pressed: run?.button,
    restarting: run?.restarting ?? false,
    busy: run !== undefined,
    error,
    chooseDataFolder,
    adoptInstallations,
    install: () => runInstall('install'),
    installAndRestart: () => runInstall('installAndRestart'),
  };
}
