import { useEffect } from 'react';
import { useBridgeChartState, useBridgeConnection } from '../bridge/BridgeSessionProvider';
import { BridgeRefusal, bridgeRefusal } from '../../shared/bridge/bridgeRefusal';
import type { BridgeStatus } from '../../shared/bridge/types';
import { LoadingMessage } from '../../shared/ui/LoadingMessage';
import { useAppSettingsView } from './AppSettingsProvider';
import { preloadSetupGuide } from './setup-guide-modal/LazySetupGuideModal';
import { SetupGuideStep } from './useAppSettings';

/** How loud the guide button reads: the only way on, or a quiet way back once the setup is done. */
type GuideButtonTone = 'primary' | 'secondary';

const GUIDE_BUTTON_CLASS: Record<GuideButtonTone, string> = {
  primary: 'modal-dialog-button primary',
  secondary: 'modal-dialog-button bridge-setup-screen-secondary',
};

interface SetupScreenNotice {
  regionLabel: string;
  title: string;
  hint: string;
  guideStep: SetupGuideStep;
  guideButtonTone: GuideButtonTone;
}

const SETUP_REGION_LABEL = 'MetaTrader 5 setup';
const WAITING_REGION_LABEL = 'Waiting for MetaTrader 5';

const CONNECT_NOTICE: SetupScreenNotice = {
  regionLabel: SETUP_REGION_LABEL,
  title: 'Connect MetaTrader 5',
  hint: 'Install the Better Charts EA in MetaTrader 5 and attach it to a chart.',
  guideStep: SetupGuideStep.Find,
  guideButtonTone: 'primary',
};

/** A token refusal is fixed by the guide's install, which hands the EA the current token. */
const TOKEN_MISMATCH_NOTICE: SetupScreenNotice = {
  regionLabel: SETUP_REGION_LABEL,
  title: 'Bridge token does not match',
  hint: 'MetaTrader 5 uses a different bridge token. Open the setup guide and choose Install and restart MT5.',
  guideStep: SetupGuideStep.Install,
  guideButtonTone: 'primary',
};

const WAITING_NOTICE: SetupScreenNotice = {
  regionLabel: WAITING_REGION_LABEL,
  title: 'Waiting for MetaTrader 5',
  hint: 'The chart appears as soon as MetaTrader 5 sends its data.',
  guideStep: SetupGuideStep.Connect,
  guideButtonTone: 'secondary',
};

/**
 * A token mismatch is fixed by the install step on any device; a finished setup is only waiting for
 * data, so its guide is a quiet way back instead of the way on.
 */
function setupScreenNotice(setupCompleted: boolean, status: BridgeStatus): SetupScreenNotice {
  if (bridgeRefusal(status) === BridgeRefusal.TokenMismatch) {
    return TOKEN_MISMATCH_NOTICE;
  }
  if (setupCompleted) {
    return WAITING_NOTICE;
  }
  return CONNECT_NOTICE;
}

/**
 * Stands in for the workspace while no chart can be drawn: the bridge is unreachable, the setup is
 * unfinished, or the bridge has not sent its first candles yet. Below the notifications and the
 * dialogs, so both still reach the user, and it takes the pointer events, because nothing behind
 * it can be used yet.
 */
export function BridgeSetupScreen() {
  const { status, tauriAvailable } = useBridgeConnection();
  const { hasCandles } = useBridgeChartState();
  const { setupCompleted, setupGuideOpen, isOpen, openSetupGuide } = useAppSettingsView();
  const setupIncomplete = !tauriAvailable || (!hasCandles && status.state !== 'connected');
  // The guide stands on its own exactly when no App settings dialog sits beneath it.
  const standaloneGuideOpen = setupGuideOpen && !isOpen;
  // A standalone guide keeps the screen until it goes, so the blur never lifts before the finished
  // screen takes over. A device that finished the setup holds the screen only for that guide: the
  // header status is the reminder left once a chart is drawn.
  const screenShown = setupIncomplete || (!setupCompleted && standaloneGuideOpen);
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
  const notice = setupScreenNotice(setupCompleted, status);
  return (
    <div className="bridge-setup-screen" role="region" aria-label={notice.regionLabel}>
      <div className="bridge-setup-screen-content">
        <LoadingMessage title={notice.title} hint={notice.hint} />
        <button
          type="button"
          className={GUIDE_BUTTON_CLASS[notice.guideButtonTone]}
          onClick={() => openSetupGuide(notice.guideStep)}
        >
          Open setup guide
        </button>
      </div>
    </div>
  );
}
