import { useEffect } from 'react';
import { useBridgeChartState, useBridgeConnection } from '../bridge/BridgeSessionProvider';
import { BridgeRefusal, bridgeRefusal } from '../../shared/bridge/bridgeRefusal';
import type { BridgeStatus } from '../../shared/bridge/types';
import { LoadingMessage } from '../../shared/ui/LoadingMessage';
import { useAppSettingsView } from './AppSettingsProvider';
import { preloadSetupGuide } from './setup-guide-modal/LazySetupGuideModal';
import { SetupGuideStep } from './useAppSettings';

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
  if (bridgeRefusal(status) === BridgeRefusal.TokenMismatch) {
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
  const { setupCompleted, openSetupGuide } = useAppSettingsView();
  const setupIncomplete = !tauriAvailable || (!hasCandles && status.state !== 'connected');
  // A device that finished the setup keeps the chart: the header status is the only
  // reminder left, and only while the bridge is away.
  const screenShown = !setupCompleted && setupIncomplete;
  // The guide is where this screen leads, so its chunk loads while the screen shows:
  // "Open setup guide" then opens it without waiting for the code.
  useEffect(() => {
    if (screenShown) {
      preloadSetupGuide();
    }
  }, [screenShown]);
  if (!screenShown) {
    return null;
  }
  const notice = setupNotice(status);
  return (
    <div className="bridge-setup-screen" role="region" aria-label="MetaTrader 5 setup">
      <div className="bridge-setup-screen-content">
        <LoadingMessage title={notice.title} hint={notice.hint} />
        <button
          type="button"
          className="modal-dialog-button primary"
          onClick={() => openSetupGuide(SetupGuideStep.Find)}
        >
          Open setup guide
        </button>
      </div>
    </div>
  );
}
