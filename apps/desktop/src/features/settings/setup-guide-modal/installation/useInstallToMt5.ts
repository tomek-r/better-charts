import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { errorText } from '../../../../shared/errorText';
import type { Mt5InstallationView, Mt5InstallReport, Mt5RestartReport } from '../../../../shared/bridge/types';
import { chooseTarget, installTargets, type InstallTarget } from './installTargets';
import { everyFileCompiledClean } from './installText';

/** The two presses the section offers: the plain install, and the install that then restarts MT5. */
export type InstallButton = 'install' | 'installAndRestart';

/** The call in flight: which button started it, and whether it has reached the restart. */
interface InstallRun {
  button: InstallButton;
  restarting: boolean;
}

/** The last finished install with the button that started it, so the section knows what it may offer next. */
interface LastInstall {
  button: InstallButton;
  report: Mt5InstallReport;
}

/** Everything the install section renders: the folders, the step in flight and the last report. */
export interface InstallToMt5View {
  shellAvailable: boolean;
  installations: Mt5InstallationView[] | undefined;
  targets: InstallTarget[];
  selected: InstallTarget | undefined;
  withoutDataFolder: Mt5InstallationView[];
  results: Mt5InstallReport | undefined;
  /** True once a plain install compiled every file clean: the section then offers the closing button. */
  installedClean: boolean;
  pressed: InstallButton | undefined;
  restarting: boolean;
  busy: boolean;
  error: string | undefined;
  chooseDataFolder: (key: string) => void;
  install: (target: InstallTarget) => Promise<void>;
  installAndRestart: (target: InstallTarget) => Promise<void>;
}

/** Both commands name the same folder: the install writes it and the restart reopens that terminal on it. */
function targetArgs(target: InstallTarget): { terminalPath: string; mql5Path: string } {
  return { terminalPath: target.terminalPath, mql5Path: target.mql5Path };
}

/**
 * The install section's state: the folders the backend listed, the last report and the
 * one in-flight call at a time. The list, install and restart commands are the section's
 * only ways to reach the backend. `onRestarted` runs once MT5 reopened with the EA attached,
 * which is the moment the setup has nothing left to ask of the user.
 */
export function useInstallToMt5(onRestarted: () => void): InstallToMt5View {
  const shellAvailable = isTauri();
  const [installations, setInstallations] = useState<Mt5InstallationView[]>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [run, setRun] = useState<InstallRun>();
  const [lastInstall, setLastInstall] = useState<LastInstall>();
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
  const results =
    lastInstall !== undefined && everyFileCompiledClean(lastInstall.report.files) ? undefined : lastInstall?.report;
  const installedClean = lastInstall?.button === 'install' && everyFileCompiledClean(lastInstall.report.files);

  /** A report or refusal belongs to the folder it was asked about, so choosing another one clears it. */
  function chooseDataFolder(key: string) {
    setSelectedKey(key);
    setLastInstall(undefined);
    setError(undefined);
  }

  /**
   * One press installs both files; `restart` adds the restart the moment every file
   * compiled clean, and a report with something to fix ends the run there so the rows
   * can say what. A refusal leaves the terminal as it was, with only the error to show.
   * Only the restart that actually reopened MT5 finishes the setup here; a clean plain
   * install instead offers the closing button, which finishes the setup the same way.
   */
  async function runInstall(target: InstallTarget, restart: boolean): Promise<void> {
    if (run !== undefined) {
      return;
    }
    const button: InstallButton = restart ? 'installAndRestart' : 'install';
    setRun({ button, restarting: false });
    setError(undefined);
    setLastInstall(undefined);
    try {
      const installed = await invoke<Mt5InstallReport>('install_to_mt5', targetArgs(target));
      setLastInstall({ button, report: installed });
      if (!restart || !everyFileCompiledClean(installed.files)) {
        return;
      }
      setRun({ button, restarting: true });
      await invoke<Mt5RestartReport>('restart_mt5_with_ea', targetArgs(target));
      onRestarted();
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
    installedClean,
    pressed: run?.button,
    restarting: run?.restarting ?? false,
    busy: run !== undefined,
    error,
    chooseDataFolder,
    install: (target: InstallTarget) => runInstall(target, false),
    installAndRestart: (target: InstallTarget) => runInstall(target, true),
  };
}
