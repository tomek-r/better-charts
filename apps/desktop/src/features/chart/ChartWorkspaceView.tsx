import { ChartTitle } from './ChartTitle';
import { ChartQuotes } from './ChartQuotes';
import { ChartTimeframes } from './timeframes/ChartTimeframes';
import { ChartCanvas } from './ChartCanvas';
import { ChartPartialClose } from './ChartPartialClose';
import { useChartDrawn } from './useChartDrawn';
import { ChartDrawingPersistence } from './drawingPersistence/ChartDrawingPersistence';

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
        <ChartDrawingPersistence />
        <ChartPartialClose />
      </ChartCanvas>
    </section>
  );
}
