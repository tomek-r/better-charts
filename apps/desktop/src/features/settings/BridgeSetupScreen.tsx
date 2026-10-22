import { useBridgeChartState, useBridgeConnection } from '../bridge/BridgeSessionProvider';
import { LoadingMessage } from '../../shared/ui/LoadingMessage';
import { useAppSettingsActions } from './AppSettingsProvider';

/**
 * Stands in for the workspace while no chart can be drawn: the bridge is unreachable or still
 * waiting for its first candles. Below the notifications and the dialogs, so both still reach
 * the user, and it takes the pointer events, because nothing behind it can be used yet.
 */
export function BridgeSetupScreen() {
  const { status, tauriAvailable } = useBridgeConnection();
  const { hasCandles } = useBridgeChartState();
  const { openSetupGuide } = useAppSettingsActions();
  const setupIncomplete = !tauriAvailable || (!hasCandles && status.state !== 'connected');
  if (!setupIncomplete) {
    return null;
  }
  return (
    <div className="bridge-setup-screen" role="region" aria-label="MetaTrader 5 setup">
      <div className="bridge-setup-screen-content">
        <LoadingMessage
          title="Connect MetaTrader 5"
          hint="Install the Better Charts EA in MetaTrader 5 and attach it to a chart."
        />
        <button type="button" className="modal-dialog-button primary" onClick={openSetupGuide}>
          Open setup guide
        </button>
      </div>
    </div>
  );
}
