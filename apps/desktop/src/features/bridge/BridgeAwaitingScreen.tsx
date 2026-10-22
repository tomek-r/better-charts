import { useEffect, useMemo, useRef, useState, type Ref, type RefObject } from 'react';
import { useBridgeConnectionSelector } from './BridgeSessionProvider';
import { useChartCannotBeDrawn } from './useChartCannotBeDrawn';
import { BridgeRefusal, bridgeRefusal } from '../../shared/bridge/bridgeRefusal';
import { useDelayedReveal } from '../../shared/hooks/useDelayedReveal';
import { afterExitAnimation } from '../../shared/ui/afterExitAnimation';
import { ErrorNotification } from '../../shared/ui/ErrorNotifications';
import { LoadingMessage } from '../../shared/ui/LoadingMessage';

/** How long the screen waits before it hands the problem to a notification and the top bar status. */
const WAITING_SCREEN_LIMIT_MS = 15_000;

const NOT_SENDING_DATA_MESSAGE =
  'MetaTrader 5 is not sending data. Check that it is running with the Better Charts EA attached and Algo Trading on.';

const TOKEN_MISMATCH_MESSAGE =
  'MetaTrader 5 uses a different bridge token. Use Token mismatch in the top bar to install the EA again.';

const AWAITING_REGION_LABEL = 'Waiting for MetaTrader 5';

/** Identity of one stretch of the screen's visibility, so an exit cannot outlive the stretch it began in. */
interface ShownStretch {
  shown: boolean;
}

/** Where the screen stands: still in the window, and on its way out or not. */
interface ExitPresence {
  rendered: boolean;
  leaving: boolean;
  screenRef: RefObject<HTMLDivElement | null>;
}

/**
 * Keeps the screen in the window for as long as its own exit animation plays, so the blur lifts off
 * the chart instead of vanishing. Arriving is immediate; only the way out is animated.
 */
function useExitPresence(shown: boolean): ExitPresence {
  const screenRef = useRef<HTMLDivElement>(null);
  // A fresh token per stretch of `shown` keeps the reset out of the effect: an exit that finishes
  // belongs to the stretch it started in and cannot outlive it.
  const stretch = useMemo<ShownStretch>(() => ({ shown }), [shown]);
  // A screen hidden from the start was never on its way out, so a drawn chart gets no fade-out flash.
  const [exitedStretch, setExitedStretch] = useState<ShownStretch | undefined>(shown ? undefined : stretch);

  useEffect(() => {
    if (shown || exitedStretch === stretch) {
      return;
    }
    return afterExitAnimation(screenRef.current, () => setExitedStretch(stretch));
  }, [exitedStretch, shown, stretch]);

  const rendered = shown || exitedStretch !== stretch;
  return { rendered, leaving: !shown && rendered, screenRef };
}

function AwaitingScreen({ leaving, screenRef }: { leaving: boolean; screenRef: Ref<HTMLDivElement> }) {
  return (
    <div
      className={`bridge-screen bridge-awaiting-screen${leaving ? ' is-leaving' : ''}`}
      ref={screenRef}
      role="region"
      aria-label={AWAITING_REGION_LABEL}
    >
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
 * silence past the limit, fades the screen out and leaves the problem to the notifications and to
 * the top bar status. Those outlive the screen and retire by themselves once the data arrives. A
 * plain protocol error already toasts from the chart and an outdated EA has its own notice, so
 * neither gets a second one here.
 */
export function BridgeAwaitingScreen() {
  const awaitingChart = useChartCannotBeDrawn();
  // The refusal kind alone, so a status heartbeat that keeps the same state never reaches this screen.
  const refusal = useBridgeConnectionSelector(({ status }) => bridgeRefusal(status));
  const bridgeError = refusal !== undefined;
  const waitingTooLong = useDelayedReveal(awaitingChart && !bridgeError, WAITING_SCREEN_LIMIT_MS);
  const screenShown = awaitingChart && !bridgeError && !waitingTooLong;
  const { rendered: screenRendered, leaving, screenRef } = useExitPresence(screenShown);
  const tokenMismatch = refusal === BridgeRefusal.TokenMismatch;
  return (
    <>
      <ErrorNotification
        noticeKey="mt5-not-sending-data"
        message={waitingTooLong ? NOT_SENDING_DATA_MESSAGE : undefined}
      />
      <ErrorNotification noticeKey="mt5-token-mismatch" message={tokenMismatch ? TOKEN_MISMATCH_MESSAGE : undefined} />
      {screenRendered && <AwaitingScreen leaving={leaving} screenRef={screenRef} />}
    </>
  );
}
