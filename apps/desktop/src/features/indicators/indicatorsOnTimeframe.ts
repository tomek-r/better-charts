import type { SavedIndicator } from '../chart/chartSettings/savedIndicators';
import { DEFAULT_TIMEFRAME_VISIBILITY, isShownOnTimeframe } from '../chart/engine/drawings/timeframeVisibility';

/**
 * The saved indicators the chart attaches on a timeframe.
 *
 * An indicator the user limited away from the chart's timeframe is not attached at all, so its line, its legend
 * row and its pane of its own leave the chart and come back on a timeframe it shows on. The Object tree keeps
 * listing it either way, because it reads the saved settings and not the chart. While the timeframe is still
 * unknown, every indicator is attached.
 */
export function indicatorsShownOn(
  saved: readonly SavedIndicator[],
  timeframeWire: string | undefined,
): readonly SavedIndicator[] {
  if (timeframeWire === undefined) {
    return saved;
  }

  return saved.filter((indicator) =>
    isShownOnTimeframe(indicator.timeframeVisibility ?? DEFAULT_TIMEFRAME_VISIBILITY, timeframeWire),
  );
}
