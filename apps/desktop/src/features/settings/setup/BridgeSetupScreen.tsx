import { useEffect } from 'react';
import { useBridgeConnectionSelector } from '../../bridge/BridgeSessionProvider';
import { BridgeRefusal, bridgeRefusal } from '../../../shared/bridge/bridgeRefusal';
import { LoadingMessage } from '../../../shared/ui/loading/LoadingMessage';
import { useAppSettingsActions } from '../AppSettingsProvider';
import { preloadSetupGuide } from './setup-guide-modal/LazySetupGuideModal';

interface SetupScreenNotice {
  title: string;
  hint: string;
}

const SETUP_REGION_LABEL = 'MetaTrader 5 setup';

const CONNECT_NOTICE: SetupScreenNotice = {
  title: 'Connect MetaTrader 5',
  hint: 'Install the Better Charts EA in MetaTrader 5 and attach it to a chart.',
};

/** A token refusal is fixed by installing again, which hands the EA the token this app knows. */
const TOKEN_MISMATCH_NOTICE: SetupScreenNotice = {
  title: 'Bridge token does not match',
  hint: 'MetaTrader 5 uses a different bridge token. Open the setup guide and choose Install and restart MT5.',
};

/** The notice of an unfinished setup: a token refusal words itself differently from any other problem. */
function setupScreenNotice(refusal: BridgeRefusal | undefined): SetupScreenNotice {
  if (refusal === BridgeRefusal.TokenMismatch) {
    return TOKEN_MISMATCH_NOTICE;
  }
  return CONNECT_NOTICE;
}

function SetupScreen({ notice }: { notice: SetupScreenNotice }) {
  const { openSetupGuide } = useAppSettingsActions();
  return (
    <div className="bridge-screen" role="region" aria-label={SETUP_REGION_LABEL}>
      <div className="bridge-screen-content">
        <LoadingMessage title={notice.title} hint={notice.hint} />
        <button type="button" className="modal-dialog-button primary" onClick={() => openSetupGuide()}>
          Open setup guide
        </button>
      </div>
    </div>
  );
}

/**
 * First run only: stands in for the workspace until this device finishes its setup. The chooser
 * mounts it only while it shows — no chart can be drawn yet, or the guide stands alone — so it
 * always renders the setup screen. Below the notifications and the dialogs, so both still reach
 * the user, and it takes the pointer events, because nothing behind it can be used yet.
 */
export function BridgeSetupScreen() {
  const refusal = useBridgeConnectionSelector(({ status }) => bridgeRefusal(status));
  // The guide is where this screen leads, so its chunk loads while the screen shows:
  // "Open setup guide" then opens it without waiting for the code.
  useEffect(() => {
    preloadSetupGuide();
  }, []);
  return <SetupScreen notice={setupScreenNotice(refusal)} />;
}
