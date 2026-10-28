import { ChartTitle } from './header/ChartTitle';
import { ChartQuotes } from './header/ChartQuotes';
import { ChartTimeframes } from './timeframes/ChartTimeframes';
import { ChartCanvas } from './ChartCanvas';
import { ChartPartialClose } from '../partial-close/ChartPartialClose';
import { useChartDrawn } from './state/useChartDrawn';
import { ChartDrawingPersistence } from './drawingPersistence/ChartDrawingPersistence';
import { ChartDrawingToolbar } from '../tools/drawingToolbar/ChartDrawingToolbar';

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
        <ChartDrawingToolbar />
      </ChartCanvas>
    </section>
  );
}
