import { invoke, isTauri } from '@tauri-apps/api/core';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { errorText } from '../../../../shared/errorText';
import { useBridgeConnectionSelector } from '../../../bridge/BridgeSessionProvider';
import type { Mt5InstallationView, Mt5InstallReport, Mt5RestartReport } from '../../../../shared/bridge/types';
import { chooseTarget, installTargets, type InstallTarget } from './installTargets';
import { everyFileCompiledClean, installDoneText } from './installText';

/**
 * Where the done line stands within its optional restart. Only `idle` shows the line
 * itself; every other step replaces it in the same reserved row, so the dialog keeps
 * its height.
 */
export type RestartStep = 'idle' | 'confirm' | 'running' | 'done';

/** Everything the install section renders: the folders, the last report and the restart's place in it. */
interface InstallToMt5View {
  shellAvailable: boolean;
  installations: Mt5InstallationView[] | undefined;
  targets: InstallTarget[];
  selected: InstallTarget | undefined;
  withoutDataFolder: Mt5InstallationView[];
  report: Mt5InstallReport | undefined;
  cleanReport: Mt5InstallReport | undefined;
  doneLine: string | undefined;
  installedTarget: InstallTarget | undefined;
  running: boolean;
  restartStep: RestartStep;
  busy: boolean;
  error: string | undefined;
  restartLink: RefObject<HTMLButtonElement | null>;
  restartConfirm: RefObject<HTMLButtonElement | null>;
  chooseDataFolder: (key: string) => void;
  install: (target: InstallTarget) => Promise<void>;
  restart: (target: InstallTarget) => Promise<void>;
  cancelRestart: () => void;
  openRestart: () => void;
}

/**
 * The install section's state: the folders the backend listed, the last report, the
 * restart's step and the one in-flight call at a time. The list, install and restart
 * commands are the section's only ways to reach the backend.
 */
export function useInstallToMt5(): InstallToMt5View {
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

  /** The restart phrase only asks: nothing reaches the backend until the confirmation's press. */
  function openRestart() {
    setRestartStep('confirm');
  }

  return {
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
  };
}
