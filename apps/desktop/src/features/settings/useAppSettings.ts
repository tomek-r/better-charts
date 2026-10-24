import { useCallback, useEffect, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DomainStore } from '../../shared/state/domainStore';
import { readSetupCompleted, saveSetupCompleted } from './setupCompletion';
import type { AppSettingsData } from './settingsTypes';

/** The three steps of the setup guide, in the order it walks them. */
export enum SetupGuideStep {
  Find = 'find',
  Install = 'install',
  Connect = 'connect',
}

export interface AppSettingsState {
  settings: AppSettingsData | undefined;
  loadRequest: Promise<void>;
  isOpen: boolean;
  closing: boolean;
  /** The setup guide is open: over the settings dialog when that is open, over the window otherwise. */
  setupGuideOpen: boolean;
  /** The step of the guide on screen; the other steps keep their own state while it is elsewhere. */
  setupGuideStep: SetupGuideStep;
  /** The setup completed while the guide was open: it is playing its slow exit before it goes. */
  setupGuideFinishing: boolean;
  /** The bridge connected while the guide was open: the finished screen stands over the chart. */
  setupCompleteShown: boolean;
  /** The finished screen replaces the blurred setup screen, so its backdrop stands at once instead of fading in. */
  setupCompleteOverSetupScreen: boolean;
  /** A blurred screen (the first-run setup screen or the after-setup waiting screen) is on the window right now. */
  blurredScreenShown: boolean;
  /** This device finished the setup, so the guide never opens on its own again. */
  setupCompleted: boolean;
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
  setupGuideStep: SetupGuideStep.Find,
  setupGuideFinishing: false,
  setupCompleteShown: false,
  setupCompleteOverSetupScreen: false,
  blurredScreenShown: false,
  setupCompleted: readSetupCompleted(),
  loadError: undefined,
  restartRequired: false,
  restartNoticeDismissed: false,
  dismissedConfigurationError: undefined,
  notificationRevision: 0,
};

export type AppSettingsStore = DomainStore<AppSettingsState>;

/**
 * First launch: the app has just generated the bridge token, so an EA already attached in MT5
 * cannot know it. No dialog opens by itself; the setup screen's guide, once the user opens it,
 * hands the EA the new token. Every handler is stable, and so is the object carrying them, so the
 * provider hands the same identity to every consumer.
 */
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
      }
    });
    return () => {
      settingsLoadGeneration.current += 1;
    };
  }, [loadSettings, store, tauriAvailable]);

  const openSettings = useCallback(() => {
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
  // Every entry point starts at the first step, because the later steps build on the
  // installation that step finds.
  const openSetupGuide = useCallback(() => {
    store.setField('setupGuideStep', SetupGuideStep.Find);
    store.setField('setupGuideOpen', true);
  }, [store]);
  const showSetupGuideStep = useCallback((step: SetupGuideStep) => store.setField('setupGuideStep', step), [store]);
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
  // "Happy trading" is the one place the setup counts as done: this device remembers it,
  // so the setup screen and the guide stay away from then on, connected or not.
  const dismissSetupComplete = useCallback(() => {
    saveSetupCompleted();
    store.setField('setupCompleted', true);
    store.setField('setupCompleteShown', false);
  }, [store]);
  // The guide has played its exit animation: it goes, and the finished screen takes the window.
  // The guide never shares the window with that screen, so it takes App settings with it when that
  // dialog sits beneath (its own exit animation still plays).
  const finishSetupGuide = useCallback(() => {
    const state = store.getState();
    // The finished screen takes the blur over at once when a blurred screen is still beneath it.
    store.setField('setupCompleteOverSetupScreen', state.blurredScreenShown);
    store.setField('setupGuideFinishing', false);
    closeSetupGuide();
    if (state.isOpen) {
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

  return useMemo(
    () => ({
      openSettings,
      openSetupGuide,
      showSetupGuideStep,
      closeSetupGuide,
      close,
      exited,
      saved,
      dismissRestartNotice,
      dismissConfigurationNotice,
      dismissSetupComplete,
      completeSetup,
      finishSetupGuide,
    }),
    [
      openSettings,
      openSetupGuide,
      showSetupGuideStep,
      closeSetupGuide,
      close,
      exited,
      saved,
      dismissRestartNotice,
      dismissConfigurationNotice,
      dismissSetupComplete,
      completeSetup,
      finishSetupGuide,
    ],
  );
}

/** The handlers the settings dialog, the header notices and the setup flow call, stable across state changes. */
export type AppSettingsHandlers = ReturnType<typeof useAppSettings>;
