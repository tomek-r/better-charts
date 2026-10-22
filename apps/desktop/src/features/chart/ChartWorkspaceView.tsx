import { ChartTitle } from './ChartTitle';
import { ChartQuotes } from './ChartQuotes';
import { ChartTimeframes } from './timeframes/ChartTimeframes';
import { ChartCanvas } from './ChartCanvas';
import { ChartPartialClose } from './ChartPartialClose';
import { useBridgeMarketSelector, useTauriAvailable } from '../bridge/BridgeSessionProvider';

/** Candles on screen are the chart; without them there is nothing to draw. */
function useChartDrawn(): boolean {
  const tauriAvailable = useTauriAvailable();
  const hasCandles = useBridgeMarketSelector(
    (market) => market.snapshot.candles.length > 0 || market.latestCandle !== undefined,
  );
  return tauriAvailable && hasCandles;
}

export function ChartWorkspaceView() {
  const chartDrawn = useChartDrawn();
  return (
    <section className={chartDrawn ? 'chart-section' : 'chart-section chart-section-waiting'}>
      <div className="chart-heading">
        <ChartTitle />
        <ChartQuotes />
      </div>
      <ChartTimeframes />
      <ChartCanvas>
        <ChartPartialClose />
      </ChartCanvas>
    </section>
  );
}
