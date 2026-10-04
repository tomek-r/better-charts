import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useAppSettings } from './useAppSettings';
import type { AppSettingsData } from './settingsTypes';

export interface AppSettingsViewState {
  settings: AppSettingsData | undefined;
  isOpen: boolean;
  closing: boolean;
  loadError: string | undefined;
  notificationRevision: number;
  restartNoticeVisible: boolean;
  configurationNotice: string | null | undefined;
  dismissRestartNotice: () => void;
  dismissConfigurationNotice: () => void;
  close: () => void;
  saved: (settings: AppSettingsData) => void;
}

export interface AppSettingsActions {
  openSettings: () => void;
}

const AppSettingsViewContext = createContext<AppSettingsViewState | null>(null);
const AppSettingsActionsContext = createContext<AppSettingsActions | null>(null);

export function AppSettingsProvider({ children, tauriAvailable }: { children: ReactNode; tauriAvailable: boolean }) {
  const settings = useAppSettings(tauriAvailable);
  const view: AppSettingsViewState = {
    settings: settings.settings,
    isOpen: settings.isOpen,
    closing: settings.closing,
    loadError: settings.loadError,
    notificationRevision: settings.notificationRevision,
    restartNoticeVisible: settings.restartNoticeVisible,
    configurationNotice: settings.configurationNotice,
    dismissRestartNotice: settings.dismissRestartNotice,
    dismissConfigurationNotice: settings.dismissConfigurationNotice,
    close: settings.close,
    saved: settings.saved,
  };
  const actions = useMemo(() => ({ openSettings: settings.open }), [settings.open]);

  return (
    <AppSettingsActionsContext.Provider value={actions}>
      <AppSettingsViewContext.Provider value={view}>{children}</AppSettingsViewContext.Provider>
    </AppSettingsActionsContext.Provider>
  );
}

export function useAppSettingsView(): AppSettingsViewState {
  const view = useContext(AppSettingsViewContext);
  if (!view) {
    throw new Error('useAppSettingsView must be used within AppSettingsProvider.');
  }
  return view;
}

export function useAppSettingsActions(): AppSettingsActions {
  const actions = useContext(AppSettingsActionsContext);
  if (!actions) {
    throw new Error('useAppSettingsActions must be used within AppSettingsProvider.');
  }
  return actions;
}
