import { BridgeAwaitingScreen } from '../bridge/BridgeAwaitingScreen';
import { useChartCannotBeDrawn } from '../bridge/useChartCannotBeDrawn';
import { useSetupCompleted, useStandaloneGuideOpen } from './AppSettingsProvider';
import { LazyBridgeSetupScreen } from './LazyBridgeSetupScreen';

/**
 * The first-run setup screen while it has anything to show: no chart can be drawn yet — the bridge
 * is unreachable, or it has not sent its first candles — or the guide stands on its own. Its own
 * primitive subscriptions keep it out of every heartbeat and candle tick, and the screen's chunk
 * loads only while the screen shows, never over a chart.
 */
function FirstRunBridgeScreen() {
  const noChartToDraw = useChartCannotBeDrawn();
  // The guide stands on its own exactly when no App settings dialog sits beneath it: the screen
  // then holds on a moment longer, so the blur never lifts before the finished screen takes over.
  const standaloneGuideOpen = useStandaloneGuideOpen();
  if (!noChartToDraw && !standaloneGuideOpen) {
    return null;
  }
  return <LazyBridgeSetupScreen />;
}

/**
 * The one blurred screen a device has: it shows the first-run setup until that setup is completed
 * here, and from then on only ever waits for MetaTrader 5 to send its data. The setup screen is
 * loaded on first need and mounted only while it shows, because a device that finished the setup
 * never shows it again, and a device that already draws its chart has nothing to be told.
 */
export function BridgeScreen() {
  const setupCompleted = useSetupCompleted();
  if (setupCompleted) {
    return <BridgeAwaitingScreen />;
  }
  return <FirstRunBridgeScreen />;
}
