import { BridgeComponentOutdatedNotice } from '../settings/setup/BridgeComponentOutdatedNotice';
import { Notification } from '../../shared/ui/notification/Notification';
import { ErrorNotifications } from '../../shared/ui/notification/ErrorNotifications';
import {
  useAppSettingsActions,
  useConfigurationNotice,
  useNotificationRevision,
} from '../settings/AppSettingsProvider';

function ConfigurationNotice() {
  const configurationNotice = useConfigurationNotice();
  const notificationRevision = useNotificationRevision();
  const { dismissConfigurationNotice } = useAppSettingsActions();
  if (!configurationNotice) {
    return null;
  }
  return (
    <Notification.Alert key={`error-${notificationRevision}-${configurationNotice}`}>
      <Notification.Message>{configurationNotice}</Notification.Message>
      <Notification.Dismiss label="Dismiss configuration notification" onDismiss={dismissConfigurationNotice} />
    </Notification.Alert>
  );
}

/** Settings notifications: the configuration error, plus a bridge refusal the bundled files fix. */
export function AppNotificationsView() {
  return (
    <Notification.Region>
      <ErrorNotifications />
      <BridgeComponentOutdatedNotice />
      <ConfigurationNotice />
    </Notification.Region>
  );
}
