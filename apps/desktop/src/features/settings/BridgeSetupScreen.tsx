import { useBridgeChartState, useBridgeConnection } from '../bridge/BridgeSessionProvider';
import type { BridgeStatus } from '../../shared/bridge/types';
import { LoadingMessage } from '../../shared/ui/LoadingMessage';
import { useAppSettingsActions } from './AppSettingsProvider';

interface SetupNotice {
  title: string;
  hint: string;
}

const CONNECT_NOTICE: SetupNotice = {
  title: 'Connect MetaTrader 5',
  hint: 'Install the Better Charts EA in MetaTrader 5 and attach it to a chart.',
};

const TOKEN_MISMATCH_NOTICE: SetupNotice = {
  title: 'Bridge token does not match',
  hint: 'MetaTrader 5 uses a different bridge token. Open the setup guide and choose Install and restart MT5.',
};

/** A token refusal is fixed by the guide's install, which hands the EA the current token. */
function setupNotice(status: BridgeStatus): SetupNotice {
  if (status.state === 'protocol_error' && status.tokenMismatch === true) {
    return TOKEN_MISMATCH_NOTICE;
  }
  return CONNECT_NOTICE;
}

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
  const notice = setupNotice(status);
  return (
    <div className="bridge-setup-screen" role="region" aria-label="MetaTrader 5 setup">
      <div className="bridge-setup-screen-content">
        <LoadingMessage title={notice.title} hint={notice.hint} />
        <button type="button" className="modal-dialog-button primary" onClick={openSetupGuide}>
          Open setup guide
        </button>
      </div>
    </div>
  );
}
