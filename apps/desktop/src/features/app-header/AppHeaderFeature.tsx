import { AppSettingsView } from '../settings/AppSettingsView';
import { BridgeScreen } from '../settings/setup/BridgeScreen';
import { SetupCompleteScreen } from '../settings/setup/SetupCompleteScreen';
import { AppHeaderView } from './AppHeaderView';
import { AppNotificationsView } from './AppNotificationsView';

/** The header, its notifications and the settings and setup surfaces, all inside the app's settings scope. */
export function AppHeaderFeature() {
  return (
    <>
      <AppHeaderView />
      <AppNotificationsView />
      <BridgeScreen />
      <SetupCompleteScreen />
      <AppSettingsView />
    </>
  );
}
