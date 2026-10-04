import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettingsData } from './settingsTypes';

export function useAppSettings(tauriAvailable: boolean) {
  const [settings, setSettings] = useState<AppSettingsData>();
  const [isOpen, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const [loadError, setLoadError] = useState<string>();
  const [restartRequired, setRestartRequired] = useState(false);
  const [restartNoticeDismissed, setRestartNoticeDismissed] = useState(false);
  const [dismissedConfigurationError, setDismissedConfigurationError] = useState<string>();
  const [notificationRevision, setNotificationRevision] = useState(0);
  useEffect(() => {
    if (!tauriAvailable) {
      return;
    }
    let active = true;
    void invoke<AppSettingsData>('get_app_settings')
      .then((next) => {
        if (!active) {
          return;
        }
        setSettings(next);
        setRestartRequired(next.restartRequired);
        if (next.firstLaunch || next.configurationError) {
          setOpen(true);
        }
      })
      .catch(() => {
        if (active) {
          setLoadError('Could not load app settings. Reopen settings to try again.');
        }
      });
    return () => {
      active = false;
    };
  }, [tauriAvailable]);
  const open = useCallback(() => {
    clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
    setClosing(false);
    setOpen(true);
    setDismissedConfigurationError(undefined);
    setLoadError(undefined);
    void invoke<AppSettingsData>('get_app_settings')
      .then(setSettings)
      .catch(() => {
        setLoadError('Could not load app settings. Close and reopen settings to try again.');
      });
  }, []);
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
      setSettings(next);
      setRestartRequired(next.restartRequired);
      setRestartNoticeDismissed(false);
      setNotificationRevision((revision) => revision + 1);
      setDismissedConfigurationError(undefined);
      close();
    },
  };
}
