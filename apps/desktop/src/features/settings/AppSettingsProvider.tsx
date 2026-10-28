import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createDomainStore } from '../../shared/providers/domainStore';
import { useRequiredContext } from '../../shared/providers/useRequiredContext';
import {
  useAppSettings,
  initialAppSettingsState,
  type AppSettingsHandlers,
  type AppSettingsState,
  type AppSettingsStore,
  type SetupGuideStep,
} from './useAppSettings';
import type { AppSettingsData } from './appSettingsData';

/** The two ways into the setup surfaces, which the header and the notices call. */
type AppSettingsActions = Pick<AppSettingsHandlers, 'openSettings' | 'openSetupGuide'>;

export type AppSettingsViewState = AppSettingsHandlers & {
  settings: AppSettingsData | undefined;
  loadRequest: Promise<void>;
  isOpen: boolean;
  closing: boolean;
  setupGuideOpen: boolean;
  setupGuideStep: SetupGuideStep;
  setupGuideFinishing: boolean;
  setupCompleteShown: boolean;
  setupCompleteOverSetupScreen: boolean;
  setupCompleted: boolean;
  loadError: string | undefined;
  notificationRevision: number;
  restartNoticeVisible: boolean;
  configurationNotice: string | null | undefined;
};

interface AppSettingsContextValue {
  store: AppSettingsStore;
  actions: AppSettingsHandlers;
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

/** One message per caller, so a hook used outside the provider names itself in its error. */
function useSettingsContext(hookName: string): AppSettingsContextValue {
  return useRequiredContext(AppSettingsContext, `${hookName} must be used within AppSettingsProvider.`);
}

function useSettingsStore(hookName: string): AppSettingsStore {
  return useSettingsContext(hookName).store;
}

export function AppSettingsProvider({ children, tauriAvailable }: { children: ReactNode; tauriAvailable: boolean }) {
  const [store] = useState(() => createDomainStore(initialAppSettingsState));
  const handlers = useAppSettings(store, tauriAvailable);
  const contextValue = useMemo(() => ({ store, actions: handlers }), [handlers, store]);

  return <AppSettingsContext value={contextValue}>{children}</AppSettingsContext>;
}

export function useAppSettingsView(): AppSettingsViewState {
  const { store, actions } = useSettingsContext('useAppSettingsView');
  const view = useStore(
    store,
    useShallow((state) => ({
      settings: state.settings,
      loadRequest: state.loadRequest,
      isOpen: state.isOpen,
      closing: state.closing,
      setupGuideOpen: state.setupGuideOpen,
      setupGuideStep: state.setupGuideStep,
      setupGuideFinishing: state.setupGuideFinishing,
      setupCompleteShown: state.setupCompleteShown,
      setupCompleteOverSetupScreen: state.setupCompleteOverSetupScreen,
      setupCompleted: state.setupCompleted,
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

/** The handlers object is stable, so its identity never changes and no consumer re-renders through it. */
export function useAppSettingsActions(): AppSettingsActions {
  return useSettingsContext('useAppSettingsActions').actions;
}

/**
 * One primitive subscription to the settings store per hook below, so a settings change reaches only
 * the components that ask for it, never the whole header.
 */
function useSettingsSelector<T>(hookName: string, selector: (state: AppSettingsState) => T): T {
  const store = useSettingsStore(hookName);
  return useStore(store, selector);
}

/** Whether this device finished the setup, so the guide never opens on its own again. */
export function useSetupCompleted(): boolean {
  return useSettingsSelector('useSetupCompleted', (state) => state.setupCompleted);
}

/** Whether the setup guide stands over the window rather than inside App settings. */
export function useStandaloneGuideOpen(): boolean {
  return useSettingsSelector('useStandaloneGuideOpen', (state) => state.setupGuideOpen && !state.isOpen);
}

/**
 * Whether the guide's exit keeps an already blurred screen on the window until the finished screen
 * takes it over; the finish itself never brings a blur in.
 */
export function useBlurHeldWhileGuideFinishes(): boolean {
  return useSettingsSelector(
    'useBlurHeldWhileGuideFinishes',
    (state) => state.setupGuideFinishing && state.blurredScreenShown,
  );
}

/**
 * Whether the setup guide, its exit or its finished screen holds the window, so the notices that
 * send the user back to the guide stay away while it is up.
 */
export function useSetupFlowOnScreen(): boolean {
  return useSettingsSelector(
    'useSetupFlowOnScreen',
    (state) => state.setupGuideOpen || state.setupGuideFinishing || state.setupCompleteShown,
  );
}

/**
 * Tells the settings store that a blurred screen sits on the window, so the finished screen knows
 * whether it replaces a blur or has to fade its own in.
 */
export function useReportBlurredScreen(shown: boolean): void {
  const store = useSettingsStore('useReportBlurredScreen');
  useEffect(() => {
    store.setField('blurredScreenShown', shown);
    return () => store.setField('blurredScreenShown', false);
  }, [shown, store]);
}
