import { ChartTitle } from './ChartTitle';
import { ChartQuotes } from './ChartQuotes';
import { ChartTimeframes } from './ChartTimeframes';
import { ChartCanvas } from './ChartCanvas';

export function ChartWorkspaceView() {
  return (
    <section className="chart-section">
      <div className="chart-heading">
        <ChartTitle />
        <ChartQuotes />
      </div>
      <ChartTimeframes />
      <ChartCanvas />
    </section>
  );
}
