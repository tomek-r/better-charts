import { BridgeRefusal, bridgeRefusal } from '../../shared/bridge/bridgeRefusal';
import { useDelayedReveal } from '../../shared/hooks/useDelayedReveal';
import { useAppSettingsActions, useSetupCompleted } from '../settings/AppSettingsProvider';
import { SetupGuideStep } from '../settings/useAppSettings';
import { useBridgeConnectionSelector } from './BridgeSessionProvider';

/** How long the bridge may stay away before the header offers a way back into the guide. */
const HEADER_STATUS_DELAY_MS = 3_000;

/** A warning while the bridge is simply away, an error colour for a refusal. */
type HeaderStatusTone = 'warn' | 'danger';

interface HeaderStatusAction {
  label: string;
  tone: HeaderStatusTone;
  /** The step of the guide that fixes this status. */
  step: SetupGuideStep;
}

/** What the header says about each refusal, and where its button sends the user. */
const REFUSAL_STATUS_ACTIONS: Record<BridgeRefusal, HeaderStatusAction> = {
  [BridgeRefusal.TokenMismatch]: { label: 'Token mismatch', tone: 'danger', step: SetupGuideStep.Install },
  [BridgeRefusal.ComponentOutdated]: { label: 'EA outdated', tone: 'danger', step: SetupGuideStep.Install },
  [BridgeRefusal.Other]: { label: 'MT5 error', tone: 'danger', step: SetupGuideStep.Connect },
};

/** What the header says about a bridge that has not answered yet. */
const NOT_CONNECTED_STATUS_ACTION: HeaderStatusAction = {
  label: 'MT5 not connected',
  tone: 'warn',
  step: SetupGuideStep.Connect,
};

/** The refusal names its fix; without one the header only reports the wait. */
function headerStatusAction(refusal: BridgeRefusal | undefined): HeaderStatusAction {
  if (refusal === undefined) {
    return NOT_CONNECTED_STATUS_ACTION;
  }
  return REFUSAL_STATUS_ACTIONS[refusal];
}

/**
 * The compact way back into the guide once the setup is done: it shows only while the
 * bridge is away, and only once that lasted long enough not to flash at every start.
 */
export function BridgeHeaderStatus() {
  const state = useBridgeConnectionSelector(({ status }) => status.state);
  const refusal = useBridgeConnectionSelector(({ status }) => bridgeRefusal(status));
  const setupCompleted = useSetupCompleted();
  const { openSetupGuide } = useAppSettingsActions();
  const notConnected = state !== 'connected';
  const shown = useDelayedReveal(notConnected, HEADER_STATUS_DELAY_MS);
  if (!setupCompleted || !shown) {
    return null;
  }
  const action = headerStatusAction(refusal);
  return (
    <button
      type="button"
      className="bridge-header-status"
      data-tone={action.tone}
      aria-label={`MetaTrader 5 connection: ${action.label}`}
      onClick={() => openSetupGuide(action.step)}
    >
      {action.label}
    </button>
  );
}
