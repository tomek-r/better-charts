import { ChartTitle } from './ChartTitle';
import { ChartQuotes } from './ChartQuotes';
import { ChartTimeframes } from './timeframes/ChartTimeframes';
import { ChartCanvas } from './ChartCanvas';
import { ChartPartialClose } from './ChartPartialClose';

export function ChartWorkspaceView() {
  return (
    <section className="chart-section">
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
