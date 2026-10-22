import { BridgeAwaitingScreen, useAwaitingBridgeData } from '../bridge/BridgeAwaitingScreen';
import { BridgeNotices } from '../bridge/BridgeNotices';
import { useChartCannotBeDrawn } from '../bridge/useChartCannotBeDrawn';
import { useSetupCompleted, useStandaloneGuideOpen } from './AppSettingsProvider';
import { LazyBridgeSetupScreen } from './LazyBridgeSetupScreen';

/**
 * A device that has not finished its setup: the first-run setup screen while it has anything to show,
 * and the bottom-right notices beside it. The screen covers the long wait itself, so the notices never
 * time it; a refusal or a lost bridge is theirs, exactly as on a device past its setup. Its own
 * primitive subscriptions keep it out of every heartbeat and candle tick, and the screen's chunk loads
 * only while the screen shows, never over a chart.
 */
function FirstRunBridge() {
  const noChartToDraw = useChartCannotBeDrawn();
  // The guide stands on its own exactly when no App settings dialog sits beneath it: the screen
  // then holds on a moment longer, so the blur never lifts before the finished screen takes over.
  const standaloneGuideOpen = useStandaloneGuideOpen();
  return (
    <>
      <BridgeNotices waitingTooLong={false} />
      {(noChartToDraw || standaloneGuideOpen) && <LazyBridgeSetupScreen />}
    </>
  );
}

/**
 * A completed setup's two surfaces: the blurred wait, and the notices that outlive it. They share
 * one measurement of the wait, so its 15 s limit is never timed twice.
 */
function CompletedSetupBridge() {
  const { screenShown, waitingTooLong } = useAwaitingBridgeData();
  return (
    <>
      <BridgeNotices waitingTooLong={waitingTooLong} />
      <BridgeAwaitingScreen screenShown={screenShown} />
    </>
  );
}

/**
 * The one blurred screen a device has, and the notices that report its bridge: a first-run device
 * shows its setup screen until that setup is completed here, and from then on only ever waits for
 * MetaTrader 5 to send its data. Either way the same notices stand at the bottom right, because a
 * refusal is as real before the setup is finished as after it.
 */
export function BridgeScreen() {
  const setupCompleted = useSetupCompleted();
  if (!setupCompleted) {
    return <FirstRunBridge />;
  }
  return <CompletedSetupBridge />;
}
