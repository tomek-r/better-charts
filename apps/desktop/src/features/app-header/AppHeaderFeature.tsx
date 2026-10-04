import { useTauriAvailable } from '../bridge/BridgeSessionProvider';
import { AppSettingsProvider } from '../settings/AppSettingsProvider';
import { AppSettingsView } from '../settings/AppSettingsView';
import { AppHeaderView } from './AppHeaderView';
import { AppNotificationsView } from './AppNotificationsView';

/** Settings state is shared by the header, its dialog and notifications only. */
export function AppHeaderFeature() {
  const tauriAvailable = useTauriAvailable();

  return (
    <AppSettingsProvider tauriAvailable={tauriAvailable}>
      <AppHeaderView />
      <AppNotificationsView />
      <AppSettingsView />
    </AppSettingsProvider>
  );
}
