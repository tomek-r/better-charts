import type { ReactNode } from 'react';
import { useTauriAvailable } from '../bridge/bridgeSelectors';
import { AppSettingsProvider } from './AppSettingsProvider';

/**
 * Settings state for everything that reads it: the header, its dialog, the notifications and the chart's
 * reconnect loader. Its selectors are primitives, so a settings change reaches only the components asking.
 */
export function AppSettingsScope({ children }: { children: ReactNode }) {
  const tauriAvailable = useTauriAvailable();
  return <AppSettingsProvider tauriAvailable={tauriAvailable}>{children}</AppSettingsProvider>;
}
