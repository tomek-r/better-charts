import { useBridgeConnectionSelector } from './BridgeSessionProvider';
import { useChartCannotBeDrawn } from './useChartCannotBeDrawn';
import { BridgeRefusal, bridgeRefusal } from '../../shared/bridge/bridgeRefusal';
import { useDelayedReveal } from '../../shared/hooks/useDelayedReveal';
import { ErrorNotification } from '../../shared/ui/ErrorNotifications';
import { LoadingMessage } from '../../shared/ui/LoadingMessage';

/** How long the screen waits before it hands the problem to a notification and the top bar status. */
const WAITING_SCREEN_LIMIT_MS = 15_000;

const NOT_SENDING_DATA_MESSAGE =
  'MetaTrader 5 is not sending data. Check that it is running with the Better Charts EA attached and Algo Trading on.';

const TOKEN_MISMATCH_MESSAGE =
  'MetaTrader 5 uses a different bridge token. Use Token mismatch in the top bar to install the EA again.';

const AWAITING_REGION_LABEL = 'Waiting for MetaTrader 5';

function AwaitingScreen() {
  return (
    <div className="bridge-screen" role="region" aria-label={AWAITING_REGION_LABEL}>
      <div className="bridge-screen-content">
        <LoadingMessage
          title="Waiting for MetaTrader 5"
          hint="The chart appears as soon as MetaTrader 5 sends its data."
        />
      </div>
    </div>
  );
}

/**
 * After the device's setup: stands in for the workspace while no chart can be drawn, so the user
 * waits on a blurred window instead of an empty one. It waits only so long — a refusal, or a
 * silence past the limit, lifts the screen and leaves the problem to the notifications and to the
 * top bar status. Those outlive the screen and retire by themselves once the data arrives. A plain
 * protocol error already toasts from the chart and an outdated EA has its own notice, so neither
 * gets a second one here.
 */
export function BridgeAwaitingScreen() {
  const awaitingChart = useChartCannotBeDrawn();
  // The refusal kind alone, so a status heartbeat that keeps the same state never reaches this screen.
  const refusal = useBridgeConnectionSelector(({ status }) => bridgeRefusal(status));
  const bridgeError = refusal !== undefined;
  const waitingTooLong = useDelayedReveal(awaitingChart && !bridgeError, WAITING_SCREEN_LIMIT_MS);
  const tokenMismatch = refusal === BridgeRefusal.TokenMismatch;
  return (
    <>
      <ErrorNotification
        noticeKey="mt5-not-sending-data"
        message={waitingTooLong ? NOT_SENDING_DATA_MESSAGE : undefined}
      />
      <ErrorNotification noticeKey="mt5-token-mismatch" message={tokenMismatch ? TOKEN_MISMATCH_MESSAGE : undefined} />
      {awaitingChart && !bridgeError && !waitingTooLong && <AwaitingScreen />}
    </>
  );
}
