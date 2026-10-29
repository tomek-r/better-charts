import { useDelayedReveal } from '../../../shared/ui/animation/useDelayedReveal';
import { useBridgeConnectionSelector, useHasCandles } from '../../bridge/bridgeSelectors';
import { useBridgeRefusal } from '../../bridge/useBridgeRefusal';
import { useSetupFlowOnScreen } from '../AppSettingsProvider';

/** A blip under 3 s stays invisible: the chart only shows it is reconnecting once the wait is no blip. */
const RECONNECT_LOADER_DELAY_MS = 3_000;

/**
 * How long a drawn chart may sit without a connected bridge before its notice shows. The EA retries at
 * most every 10 s once its backoff has grown (BackoffSeconds in BetterChartsBridge.mq5), so the notice
 * waits out one full retry gap plus the handshake before it calls MT5 not connected.
 */
const DISCONNECTED_NOTICE_DELAY_MS = 12_000;

/**
 * What a drawn chart shows while its bridge is away: nothing for a blip, then a loader over the chart,
 * then the not-connected notice in the loader's place. A refusal or the setup flow on screen explains the
 * wait itself, so neither shows.
 */
export function useBridgeReconnectWait(): { loaderShown: boolean; noticeShown: boolean } {
  const setupFlowOnScreen = useSetupFlowOnScreen();
  const refusal = useBridgeRefusal();
  const bridgeState = useBridgeConnectionSelector(({ status }) => status.state);
  const hasCandles = useHasCandles();
  const waitingForBridge = hasCandles && bridgeState !== 'connected' && refusal === undefined && !setupFlowOnScreen;
  const waitedForLoader = useDelayedReveal(waitingForBridge, RECONNECT_LOADER_DELAY_MS);
  const noticeShown = useDelayedReveal(waitingForBridge, DISCONNECTED_NOTICE_DELAY_MS);
  return { loaderShown: waitedForLoader && !noticeShown, noticeShown };
}
