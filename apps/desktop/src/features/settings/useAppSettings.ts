import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Mt5InstallationView } from '../../shared/bridge/types';
import type { DomainStore } from '../../shared/state/domainStore';
import { anyDataFolderHoldsTheExpertAdvisor } from './setup-guide-modal/installation/expertAdvisorInstalled';
import type { AppSettingsData } from './settingsTypes';

export interface AppSettingsState {
  settings: AppSettingsData | undefined;
  loadRequest: Promise<void>;
  isOpen: boolean;
  closing: boolean;
  /** The setup guide is open: over the settings dialog when that is open, over the window otherwise. */
  setupGuideOpen: boolean;
  /** The setup completed while the guide was open: it is playing its slow exit before it goes. */
  setupGuideFinishing: boolean;
  /** The bridge connected while the guide was open: the finished screen stands over the chart. */
  setupCompleteShown: boolean;
  loadError: string | undefined;
  restartRequired: boolean;
  restartNoticeDismissed: boolean;
  dismissedConfigurationError: string | undefined;
  notificationRevision: number;
}

export const initialAppSettingsState: AppSettingsState = {
  settings: undefined,
  loadRequest: Promise.resolve(),
  isOpen: false,
  closing: false,
  setupGuideOpen: false,
  setupGuideFinishing: false,
  setupCompleteShown: false,
  loadError: undefined,
  restartRequired: false,
  restartNoticeDismissed: false,
  dismissedConfigurationError: undefined,
  notificationRevision: 0,
};

export type AppSettingsStore = DomainStore<AppSettingsState>;

/**
 * First launch: the guide owns the manual steps, so it opens alone unless some data folder
 * already holds the bridge EA's source. An empty listing (no MetaTrader 5 found) counts as
 * "not installed"; a failed listing falls back to App settings.
 */
function openFirstLaunchView(store: AppSettingsStore, settingsLoadGeneration: { readonly current: number }): void {
  // loadSettings runs its callback only for the load that is still current, so the
  // value read here is this load's generation.
  const generation = settingsLoadGeneration.current;
  void invoke<Mt5InstallationView[]>('list_mt5_installations')
    .then((installations) => {
      if (generation !== settingsLoadGeneration.current) {
        return;
      }
      if (anyDataFolderHoldsTheExpertAdvisor(installations)) {
        store.setField('isOpen', true);
        return;
      }
      store.setField('setupGuideOpen', true);
    })
    .catch(() => {
      if (generation === settingsLoadGeneration.current) {
        store.setField('isOpen', true);
      }
    });
}

export function useAppSettings(store: AppSettingsStore, tauriAvailable: boolean) {
  const settingsLoadGeneration = useRef(0);

  const loadSettings = useCallback(
    (errorMessage: string, onLoaded?: (next: AppSettingsData) => void) => {
      const generation = ++settingsLoadGeneration.current;
      const loadRequest = invoke<AppSettingsData>('get_app_settings')
        .then((next) => {
          if (generation !== settingsLoadGeneration.current) {
            return;
          }
          store.setField('settings', next);
          onLoaded?.(next);
        })
        .catch(() => {
          if (generation === settingsLoadGeneration.current) {
            store.setField('loadError', errorMessage);
          }
        });
      store.setField('loadRequest', loadRequest);
    },
    [store],
  );

  useEffect(
    () => () => {
      settingsLoadGeneration.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (!tauriAvailable) {
      return;
    }
    loadSettings('Could not load app settings. Reopen settings to try again.', (next) => {
      store.setField('restartRequired', next.restartRequired);
      if (next.configurationError) {
        store.setField('isOpen', true);
        return;
      }
      if (next.firstLaunch) {
        openFirstLaunchView(store, settingsLoadGeneration);
      }
    });
    return () => {
      settingsLoadGeneration.current += 1;
    };
  }, [loadSettings, store, tauriAvailable]);

  const open = useCallback(() => {
    store.setField('closing', false);
    store.setField('setupGuideOpen', false);
    store.setField('dismissedConfigurationError', undefined);
    store.setField('loadError', undefined);
    loadSettings('Could not load app settings. Close and reopen settings to try again.');
    store.setField('isOpen', true);
  }, [loadSettings, store]);
  // The guide stands on its own window, so any surface can open it without App settings
  // beneath it (e.g. a connection error offering to reinstall the bundled MT5 files);
  // App settings renders it nested when that dialog is already open.
  const openSetupGuide = useCallback(() => store.setField('setupGuideOpen', true), [store]);
  const closeSetupGuide = useCallback(() => store.setField('setupGuideOpen', false), [store]);
  // The dialog keeps its focus trap mounted while the exit animation plays and
  // calls `exited` when it ends (AppSettingsDialog), which finishes the close.
  const close = useCallback(() => {
    if (!store.getState().closing) {
      store.setField('closing', true);
    }
  }, [store]);
  const exited = useCallback(() => {
    store.setField('isOpen', false);
    store.setField('closing', false);
    store.setField('setupGuideOpen', false);
  }, [store]);
  const dismissRestartNotice = useCallback(() => store.setField('restartNoticeDismissed', true), [store]);
  const showSetupComplete = useCallback(() => store.setField('setupCompleteShown', true), [store]);
  const dismissSetupComplete = useCallback(() => store.setField('setupCompleteShown', false), [store]);
  // The guide has played its exit animation: it goes, and the finished screen takes the window.
  // The guide never shares the window with that screen, so it takes App settings with it when that
  // dialog sits beneath (its own exit animation still plays).
  const finishSetupGuide = useCallback(() => {
    store.setField('setupGuideFinishing', false);
    closeSetupGuide();
    if (store.getState().isOpen) {
      close();
    }
    showSetupComplete();
  }, [close, closeSetupGuide, showSetupComplete, store]);
  // The guide fades out first and `finishSetupGuide` runs once it is gone; with no guide on screen
  // there is nothing to fade, so the finish runs straight away.
  const completeSetup = useCallback(() => {
    if (store.getState().setupGuideOpen) {
      store.setField('setupGuideFinishing', true);
      return;
    }
    finishSetupGuide();
  }, [finishSetupGuide, store]);
  const dismissConfigurationNotice = useCallback(
    () => store.setField('dismissedConfigurationError', store.getState().settings?.configurationError ?? undefined),
    [store],
  );
  const saved = useCallback(
    (next: AppSettingsData) => {
      settingsLoadGeneration.current += 1;
      store.setField('settings', next);
      store.setField('restartRequired', next.restartRequired);
      store.setField('restartNoticeDismissed', false);
      store.setField('notificationRevision', (revision) => revision + 1);
      store.setField('dismissedConfigurationError', undefined);
      close();
    },
    [close, store],
  );

  return {
    open,
    openSetupGuide,
    closeSetupGuide,
    close,
    exited,
    saved,
    dismissRestartNotice,
    dismissConfigurationNotice,
    showSetupComplete,
    dismissSetupComplete,
    completeSetup,
    finishSetupGuide,
  };
}
