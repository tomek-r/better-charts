import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { DomainStore } from '../../shared/state/domainStore';
import type { AppSettingsData } from './settingsTypes';

export interface AppSettingsState {
  settings: AppSettingsData | undefined;
  isOpen: boolean;
  closing: boolean;
  loadError: string | undefined;
  restartRequired: boolean;
  restartNoticeDismissed: boolean;
  dismissedConfigurationError: string | undefined;
  notificationRevision: number;
}

export const initialAppSettingsState: AppSettingsState = {
  settings: undefined,
  isOpen: false,
  closing: false,
  loadError: undefined,
  restartRequired: false,
  restartNoticeDismissed: false,
  dismissedConfigurationError: undefined,
  notificationRevision: 0,
};

export type AppSettingsStore = DomainStore<AppSettingsState>;

export function useAppSettings(store: AppSettingsStore, tauriAvailable: boolean) {
  const settingsLoadGeneration = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadSettings = useCallback(
    (errorMessage: string, onLoaded?: (next: AppSettingsData) => void) => {
      const generation = ++settingsLoadGeneration.current;
      void invoke<AppSettingsData>('get_app_settings')
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
    },
    [store],
  );

  useEffect(
    () => () => {
      clearTimeout(closeTimer.current);
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
      if (next.firstLaunch || next.configurationError) {
        store.setField('isOpen', true);
      }
    });
    return () => {
      settingsLoadGeneration.current += 1;
    };
  }, [loadSettings, store, tauriAvailable]);

  const open = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    store.setField('closing', false);
    store.setField('isOpen', true);
    store.setField('dismissedConfigurationError', undefined);
    store.setField('loadError', undefined);
    loadSettings('Could not load app settings. Close and reopen settings to try again.');
  }, [loadSettings, store]);
  const close = useCallback(() => {
    if (closeTimer.current !== undefined) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      store.setField('isOpen', false);
      store.setField('closing', false);
      return;
    }
    store.setField('closing', true);
    // Keep the focus trap mounted through the 180ms CSS exit animation.
    closeTimer.current = setTimeout(() => {
      closeTimer.current = undefined;
      store.setField('isOpen', false);
      store.setField('closing', false);
    }, 180);
  }, [store]);
  const dismissRestartNotice = useCallback(() => store.setField('restartNoticeDismissed', true), [store]);
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
    close,
    saved,
    dismissRestartNotice,
    dismissConfigurationNotice,
  };
}
