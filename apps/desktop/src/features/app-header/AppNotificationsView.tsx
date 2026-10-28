import { BridgeComponentOutdatedNotice } from '../settings/setup/BridgeComponentOutdatedNotice';
import { Notification } from '../../shared/ui/notification/Notification';
import { ErrorNotifications } from '../../shared/ui/notification/ErrorNotifications';
import {
  useAppSettingsActions,
  useConfigurationNotice,
  useNotificationRevision,
  useRestartNoticeVisible,
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

function RestartNotice() {
  const restartNoticeVisible = useRestartNoticeVisible();
  const notificationRevision = useNotificationRevision();
  const { dismissRestartNotice } = useAppSettingsActions();
  if (!restartNoticeVisible) {
    return null;
  }
  return (
    <Notification.Status key={`restart-${notificationRevision}`}>
      <span>Settings saved. Restart Better Charts to apply changes.</span>
      <Notification.Dismiss label="Dismiss settings saved notification" onDismiss={dismissRestartNotice} />
    </Notification.Status>
  );
}

/** Settings notifications: the configuration error and the restart reminder, plus a bridge refusal the bundled files fix. */
export function AppNotificationsView() {
  return (
    <Notification.Region>
      <ErrorNotifications />
      <BridgeComponentOutdatedNotice />
      <ConfigurationNotice />
      <RestartNotice />
    </Notification.Region>
  );
}
