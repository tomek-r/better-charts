import { BridgeComponentOutdatedNotice } from '../settings/setup/BridgeComponentOutdatedNotice';
import { Notification } from '../../shared/ui/notification/Notification';
import { ErrorNotifications } from '../../shared/ui/notification/ErrorNotifications';
import { useAppSettingsView } from '../settings/AppSettingsProvider';

function ConfigurationNotice() {
  const settings = useAppSettingsView();
  if (!settings.configurationNotice) {
    return null;
  }
  return (
    <Notification.Alert key={`error-${settings.notificationRevision}-${settings.configurationNotice}`}>
      <Notification.Message>{settings.configurationNotice}</Notification.Message>
      <Notification.Dismiss
        label="Dismiss configuration notification"
        onDismiss={settings.dismissConfigurationNotice}
      />
    </Notification.Alert>
  );
}

function RestartNotice() {
  const settings = useAppSettingsView();
  if (!settings.restartNoticeVisible) {
    return null;
  }
  return (
    <Notification.Status key={`restart-${settings.notificationRevision}`}>
      <span>Settings saved. Restart Better Charts to apply changes.</span>
      <Notification.Dismiss label="Dismiss settings saved notification" onDismiss={settings.dismissRestartNotice} />
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
