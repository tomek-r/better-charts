import { createContext, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createDomainStore } from '../../shared/state/domainStore';
import { useRequiredContext } from '../../shared/state/useRequiredContext';
import { useAppSettings, initialAppSettingsState, type AppSettingsStore } from './useAppSettings';
import type { AppSettingsData } from './settingsTypes';

/** The handlers the settings dialog and header notices call; stable across state changes. */
interface AppSettingsHandlers {
  dismissRestartNotice: () => void;
  dismissConfigurationNotice: () => void;
  close: () => void;
  exited: () => void;
  saved: (settings: AppSettingsData) => void;
}

export interface AppSettingsViewState extends AppSettingsHandlers {
  settings: AppSettingsData | undefined;
  loadRequest: Promise<void>;
  isOpen: boolean;
  closing: boolean;
  loadError: string | undefined;
  notificationRevision: number;
  restartNoticeVisible: boolean;
  configurationNotice: string | null | undefined;
}

export interface AppSettingsActions {
  openSettings: () => void;
}

interface AppSettingsContextValue {
  store: AppSettingsStore;
  actions: AppSettingsActions & AppSettingsHandlers;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

export function AppSettingsProvider({ children, tauriAvailable }: { children: ReactNode; tauriAvailable: boolean }) {
  const [store] = useState(() => createDomainStore(initialAppSettingsState));
  const settings = useAppSettings(store, tauriAvailable);
  const actions = useMemo(
    () => ({
      openSettings: settings.open,
      dismissRestartNotice: settings.dismissRestartNotice,
      dismissConfigurationNotice: settings.dismissConfigurationNotice,
      close: settings.close,
      exited: settings.exited,
      saved: settings.saved,
    }),
    [
      settings.close,
      settings.exited,
      settings.dismissConfigurationNotice,
      settings.dismissRestartNotice,
      settings.open,
      settings.saved,
    ],
  );
  const contextValue = useMemo(() => ({ store, actions }), [actions, store]);

  return <AppSettingsContext value={contextValue}>{children}</AppSettingsContext>;
}

export function useAppSettingsView(): AppSettingsViewState {
  const { store, actions } = useRequiredContext(
    AppSettingsContext,
    'useAppSettingsView must be used within AppSettingsProvider.',
  );
  const view = useStore(
    store,
    useShallow((state) => ({
      settings: state.settings,
      loadRequest: state.loadRequest,
      isOpen: state.isOpen,
      closing: state.closing,
      loadError: state.loadError,
      notificationRevision: state.notificationRevision,
      restartNoticeVisible: state.restartRequired && !state.restartNoticeDismissed,
      configurationNotice:
        state.settings?.configurationError !== state.dismissedConfigurationError
          ? state.settings?.configurationError
          : undefined,
    })),
  );

  return { ...view, ...actions };
}

export function useAppSettingsActions(): AppSettingsActions {
  const { actions } = useRequiredContext(
    AppSettingsContext,
    'useAppSettingsActions must be used within AppSettingsProvider.',
  );
  return useMemo(() => ({ openSettings: actions.openSettings }), [actions]);
}
