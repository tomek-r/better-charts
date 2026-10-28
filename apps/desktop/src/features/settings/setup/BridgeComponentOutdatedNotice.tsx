import { useState } from 'react';
import { BridgeRefusal, bridgeRefusal } from '../../../shared/bridge/bridgeRefusal';
import { Notification } from '../../../shared/ui/notification/Notification';
import { useAppSettingsActions } from '../AppSettingsProvider';
import { useBridgeConnectionSelector } from '../../bridge/BridgeSessionProvider';

/**
 * The one refusal the bundled MT5 files fix: the installed EA or tick reader is
 * not the version this app requires. It stands in for the plain error toast of
 * that case so the message comes with the fix (the setup guide's automatic
 * install). Dismissal is per message, and the notice disappears on its own once
 * the bridge reaches any other state.
 */
export function BridgeComponentOutdatedNotice() {
  const message = useBridgeConnectionSelector(({ status }) =>
    bridgeRefusal(status) === BridgeRefusal.ComponentOutdated ? status.message : undefined,
  );
  const { openSetupGuide } = useAppSettingsActions();
  const [dismissed, setDismissed] = useState<string>();
  if (!message || message === dismissed) {
    return null;
  }
  return (
    <Notification.Alert>
      <Notification.Message>{message}</Notification.Message>
      <button type="button" className="primary-button notification-action" onClick={() => openSetupGuide()}>
        Update in MT5
      </button>
      <Notification.Dismiss label="Dismiss error notification" onDismiss={() => setDismissed(message)} />
    </Notification.Alert>
  );
}
