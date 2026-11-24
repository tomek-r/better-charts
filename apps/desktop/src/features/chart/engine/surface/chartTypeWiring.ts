import type { Candle } from '../../../../shared/bridge/types';
import { ChartTypeBarSource, type ChartTypeBarsPort, type ChartTypeReplaceOptions } from '../bars/chartTypeBars';
import type { ChartHistory } from './chartHistory';
import type { LiveBarController } from './liveBarController';

/** The chart's own seams a chart type's bars write through, none of which exists before the source itself. */
export interface ChartTypeBarsSeams {
  /** The app's transform; without one the chart keeps drawing its base candles. */
  readonly port: ChartTypeBarsPort | undefined;
  /** The chart's history, which a replaced window of bars replaces; built after the source, so read on call. */
  readonly history: () => ChartHistory;
  /** The live bar, which writes the newest bar of an answer that moved nothing older. */
  readonly liveBar: () => LiveBarController;
  /** Puts the pane back on the end anchor, which a replacement it could not carry over asks for. */
  readonly resetView: () => void;
}

/**
 * Builds the chart's chart-type bar source and wires the bars it answers with into the chart's own history
 * seams: a replacement replaces the whole series, the newest bar alone is written as a live bar, and the end of
 * the base candles stops the paging. The controller holds the source and nothing of how its bars reach the chart.
 */
export function createChartTypeBars(seams: ChartTypeBarsSeams): ChartTypeBarSource {
  const { port, history, liveBar, resetView } = seams;
  return new ChartTypeBarSource({
    port,
    sink: {
      replace: (candles, options) => replaceHistoryWithChartTypeBars(history(), candles, options, resetView),
      writeLastBar: (candle) => liveBar().applyComputed(candle),
      historyEnded: () => history().appendOlder([], false),
    },
  });
}

/**
 * Replaces the chart with the bars a chart type drew, and puts the pane where the replacement of the base
 * candles would have: a window the view could not be carried over reopens on the end anchor.
 */
function replaceHistoryWithChartTypeBars(
  history: ChartHistory,
  candles: readonly Candle[],
  options: ChartTypeReplaceOptions,
  resetView: () => void,
): void {
  if (!history.replace(candles, options)) {
    resetView();
  }
}
