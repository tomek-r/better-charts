import { Notification } from '../../shared/ui/Notification';
import { ErrorNotifications } from '../../shared/ui/ErrorNotifications';
import { useAppSettingsView } from '../settings/AppSettingsProvider';

/** Settings notifications: the configuration error and the restart reminder. */
export function AppNotificationsView() {
  const settings = useAppSettingsView();

  return (
    <Notification.Region>
      <ErrorNotifications />
      {settings.configurationNotice ? (
        <Notification.Alert key={`error-${settings.notificationRevision}-${settings.configurationNotice}`}>
          <span>{settings.configurationNotice}</span>
          <Notification.Dismiss
            label="Dismiss configuration notification"
            onDismiss={settings.dismissConfigurationNotice}
          />
        </Notification.Alert>
      ) : null}
      {settings.restartNoticeVisible ? (
        <Notification.Status key={`restart-${settings.notificationRevision}`}>
          <span>Settings saved. Restart Better Charts to apply changes.</span>
          <Notification.Dismiss label="Dismiss settings saved notification" onDismiss={settings.dismissRestartNotice} />
        </Notification.Status>
      ) : null}
    </Notification.Region>
  );
}
