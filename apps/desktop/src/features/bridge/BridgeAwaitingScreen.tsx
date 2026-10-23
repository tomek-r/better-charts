import { useEffect, useMemo, useRef, useState, type Ref, type RefObject } from 'react';
import { useBridgeConnectionSelector } from './BridgeSessionProvider';
import { useChartCannotBeDrawn } from './useChartCannotBeDrawn';
import { useReportBlurredScreen } from '../settings/AppSettingsProvider';
import { bridgeRefusal } from '../../shared/bridge/bridgeRefusal';
import { useDelayedReveal } from '../../shared/hooks/useDelayedReveal';
import { afterExitAnimation } from '../../shared/ui/afterExitAnimation';
import { LoadingMessage } from '../../shared/ui/LoadingMessage';

/** How long the screen keeps the window before the notices beside it take the problem over. */
const AWAITING_DATA_LIMIT_MS = 15_000;

const AWAITING_REGION_LABEL = 'Waiting for MetaTrader 5';

/** The wait of a completed setup, as both of its surfaces need it: the screen, and its notice. */
export interface AwaitingBridgeData {
  /** No chart can be drawn yet and the bridge has not refused: the blurred screen stands in for the chart. */
  screenShown: boolean;
  /** The wait outlasted its limit, so the screen goes and a notice says what to check. */
  waitingTooLong: boolean;
}

/**
 * Measures the wait once for its two surfaces, so its limit is never timed twice. Every part is a
 * primitive subscription, so a heartbeat that keeps the same state reaches neither of them.
 */
export function useAwaitingBridgeData(): AwaitingBridgeData {
  const noChartToDraw = useChartCannotBeDrawn();
  // The refusal kind alone; each surface names the refusal it reports.
  const refusal = useBridgeConnectionSelector(({ status }) => bridgeRefusal(status));
  const awaitingData = noChartToDraw && refusal === undefined;
  const waitingTooLong = useDelayedReveal(awaitingData, AWAITING_DATA_LIMIT_MS);
  return { screenShown: awaitingData && !waitingTooLong, waitingTooLong };
}

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
 * waits on a blurred window instead of an empty one. It waits only so long — a refusal, or a silence
 * past the limit, fades the screen out and leaves the problem to the notices beside it, which outlive
 * the screen and retire by themselves once the data arrives.
 */
export function BridgeAwaitingScreen({ screenShown }: { screenShown: boolean }) {
  const { rendered: screenRendered, leaving, screenRef } = useExitPresence(screenShown);
  // Rendered rather than shown: the blur stays until the fade-out ends, so it never blinks off.
  useReportBlurredScreen(screenRendered);
  if (!screenRendered) {
    return null;
  }
  return <AwaitingScreen leaving={leaving} screenRef={screenRef} />;
}
