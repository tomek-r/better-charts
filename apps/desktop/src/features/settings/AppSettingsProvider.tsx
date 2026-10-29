import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createFieldStore } from '../../shared/store/fieldStore';
import { useRequiredContext } from '../../shared/context/useRequiredContext';
import {
  useAppSettings,
  initialAppSettingsState,
  type AppSettingsHandlers,
  type AppSettingsState,
  type AppSettingsStore,
  type SetupGuideStep,
} from './useAppSettings';
import type { AppSettingsData } from './appSettingsData';

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
  const [store] = useState(() => createFieldStore(initialAppSettingsState));
  const handlers = useAppSettings(store, tauriAvailable);
  const contextValue = useMemo(() => ({ store, actions: handlers }), [handlers, store]);

  return <AppSettingsContext value={contextValue}>{children}</AppSettingsContext>;
}

const selectConfigurationNotice = (state: AppSettingsState) =>
  state.settings?.configurationError !== state.dismissedConfigurationError
    ? state.settings?.configurationError
    : undefined;

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
      configurationNotice: selectConfigurationNotice(state),
    })),
  );

  return { ...view, ...actions };
}

/** The handlers object is stable, so its identity never changes and no consumer re-renders through it. */
export function useAppSettingsActions(): AppSettingsHandlers {
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

/** The step of the setup guide on screen. */
export function useSetupGuideStep(): SetupGuideStep {
  return useSettingsSelector('useSetupGuideStep', (state) => state.setupGuideStep);
}

/** Whether the setup guide is open, over the settings dialog or over the window. */
export function useSetupGuideOpen(): boolean {
  return useSettingsSelector('useSetupGuideOpen', (state) => state.setupGuideOpen);
}

/** Whether the finished screen stands over the chart. */
export function useSetupCompleteShown(): boolean {
  return useSettingsSelector('useSetupCompleteShown', (state) => state.setupCompleteShown);
}

/** Whether the settings dialog is open. */
export function useSettingsDialogOpen(): boolean {
  return useSettingsSelector('useSettingsDialogOpen', (state) => state.isOpen);
}

/** Whether the finished screen replaces a blurred screen, so its backdrop stands at once. */
export function useSetupCompleteOverSetupScreen(): boolean {
  return useSettingsSelector('useSetupCompleteOverSetupScreen', (state) => state.setupCompleteOverSetupScreen);
}

/** The bridge token of the saved settings; `undefined` until the settings load. */
export function useBridgeToken(): string | undefined {
  return useSettingsSelector('useBridgeToken', (state) => state.settings?.mt5BridgeSettings.token);
}

/** The configuration error to show, `undefined` once dismissed. */
export function useConfigurationNotice(): string | null | undefined {
  return useSettingsSelector('useConfigurationNotice', selectConfigurationNotice);
}

/** Changes whenever settings are saved, so a notice that was dismissed shows again. */
export function useNotificationRevision(): number {
  return useSettingsSelector('useNotificationRevision', (state) => state.notificationRevision);
}

/** Operating system the app runs on; `undefined` until the settings load. */
export function useAppPlatform(): AppSettingsData['platform'] | undefined {
  return useSettingsSelector('useAppPlatform', (state) => state.settings?.platform);
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
