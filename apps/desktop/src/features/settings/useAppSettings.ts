import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettingsData } from './settingsTypes';

export function useAppSettings(tauriAvailable: boolean) {
  const [settings, setSettings] = useState<AppSettingsData>();
  const [isOpen, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const settingsLoadGeneration = useRef(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [loadError, setLoadError] = useState<string>();
  const [restartRequired, setRestartRequired] = useState(false);
  const [restartNoticeDismissed, setRestartNoticeDismissed] = useState(false);
  const [dismissedConfigurationError, setDismissedConfigurationError] = useState<string>();
  const [notificationRevision, setNotificationRevision] = useState(0);
  const loadSettings = useCallback((errorMessage: string, onLoaded?: (next: AppSettingsData) => void) => {
    const generation = ++settingsLoadGeneration.current;
    void invoke<AppSettingsData>('get_app_settings')
      .then((next) => {
        if (generation !== settingsLoadGeneration.current) {
          return;
        }
        setSettings(next);
        onLoaded?.(next);
      })
      .catch(() => {
        if (generation === settingsLoadGeneration.current) {
          setLoadError(errorMessage);
        }
      });
  }, []);
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
      setRestartRequired(next.restartRequired);
      if (next.firstLaunch || next.configurationError) {
        setOpen(true);
      }
    });
    return () => {
      settingsLoadGeneration.current += 1;
    };
  }, [loadSettings, tauriAvailable]);
  const open = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    setClosing(false);
    setOpen(true);
    setDismissedConfigurationError(undefined);
    setLoadError(undefined);
    loadSettings('Could not load app settings. Close and reopen settings to try again.');
  }, [loadSettings]);
  const close = useCallback(() => {
    if (closeTimer.current !== undefined) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setOpen(false);
      setClosing(false);
      return;
    }
    setClosing(true);
    // Keep the focus trap mounted through the 180ms CSS exit animation.
    closeTimer.current = setTimeout(() => {
      closeTimer.current = undefined;
      setOpen(false);
      setClosing(false);
    }, 180);
  }, []);
  return {
    settings,
    isOpen,
    closing,
    loadError,
    restartRequired,
    notificationRevision,
    restartNoticeVisible: restartRequired && !restartNoticeDismissed,
    configurationNotice:
      settings?.configurationError !== dismissedConfigurationError ? settings?.configurationError : undefined,
    dismissRestartNotice: () => setRestartNoticeDismissed(true),
    dismissConfigurationNotice: () => setDismissedConfigurationError(settings?.configurationError ?? undefined),
    open,
    close,
    saved: (next: AppSettingsData) => {
      settingsLoadGeneration.current += 1;
      setSettings(next);
      setRestartRequired(next.restartRequired);
      setRestartNoticeDismissed(false);
      setNotificationRevision((revision) => revision + 1);
      setDismissedConfigurationError(undefined);
      close();
    },
  };
}
