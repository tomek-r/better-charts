import { ChartTitle } from './header/ChartTitle';
import { ChartQuotes } from './header/ChartQuotes';
import { ChartTimeframes } from './timeframes/ChartTimeframes';
import { ChartCanvas } from './ChartCanvas';
import { ChartTimeZoneControl } from './timeZone/ChartTimeZoneControl';
import { ChartPartialClose } from '../partial-close/ChartPartialClose';
import { useChartDrawn } from './useChartDrawn';
import { ChartDrawingPersistence } from './drawingPersistence/ChartDrawingPersistence';
import { ChartDrawingToolbar } from '../tools/drawingToolbar/ChartDrawingToolbar';

export function ChartWorkspaceView() {
  const chartDrawn = useChartDrawn();
  return (
    <div className="chart-workspace">
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
      <div className="chart-footer">
        <ChartTimeZoneControl />
      </div>
    </div>
  );
}
