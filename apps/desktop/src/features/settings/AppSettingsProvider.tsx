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
  closeSetupGuide: () => void;
  close: () => void;
  exited: () => void;
  saved: (settings: AppSettingsData) => void;
  showSetupComplete: () => void;
  dismissSetupComplete: () => void;
}

export interface AppSettingsActions {
  openSettings: () => void;
  /** Opens the setup guide on its own; inside the open settings dialog it sits on top of that. */
  openSetupGuide: () => void;
}

export interface AppSettingsViewState extends AppSettingsHandlers, AppSettingsActions {
  settings: AppSettingsData | undefined;
  loadRequest: Promise<void>;
  isOpen: boolean;
  closing: boolean;
  setupGuideOpen: boolean;
  setupCompleteShown: boolean;
  loadError: string | undefined;
  notificationRevision: number;
  restartNoticeVisible: boolean;
  configurationNotice: string | null | undefined;
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
      openSetupGuide: settings.openSetupGuide,
      dismissRestartNotice: settings.dismissRestartNotice,
      dismissConfigurationNotice: settings.dismissConfigurationNotice,
      closeSetupGuide: settings.closeSetupGuide,
      close: settings.close,
      exited: settings.exited,
      saved: settings.saved,
      showSetupComplete: settings.showSetupComplete,
      dismissSetupComplete: settings.dismissSetupComplete,
    }),
    [
      settings.close,
      settings.closeSetupGuide,
      settings.exited,
      settings.dismissConfigurationNotice,
      settings.dismissRestartNotice,
      settings.open,
      settings.openSetupGuide,
      settings.saved,
      settings.showSetupComplete,
      settings.dismissSetupComplete,
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
      setupGuideOpen: state.setupGuideOpen,
      setupCompleteShown: state.setupCompleteShown,
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
  return useMemo(
    () => ({ openSettings: actions.openSettings, openSetupGuide: actions.openSetupGuide }),
    [actions.openSettings, actions.openSetupGuide],
  );
}
