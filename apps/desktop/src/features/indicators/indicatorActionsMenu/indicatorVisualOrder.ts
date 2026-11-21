import type { SavedIndicator } from '../../chart/chartSettings/savedIndicators';
import { findChartIndicatorPlugin } from '../registry';

/** The rows an indicator moves to when it goes to the front or the back of its price pane's paint order. */
export interface VisualOrderTargets {
  readonly frontInstanceId: string;
  readonly backInstanceId: string;
}

/** The price-pane indicators' instance ids, in the saved order the chart paints them in. */
function pricePaneInstanceIds(indicators: readonly SavedIndicator[]): string[] {
  return indicators.flatMap((indicator) =>
    findChartIndicatorPlugin(indicator.definitionId)?.pane === 'overlay' ? [indicator.instanceId] : [],
  );
}

/**
 * Where "Bring to front" and "Send to back" move an indicator, or undefined for one with a pane of its own: the
 * pane has a place of its own under the price pane, so it has no paint order among the price pane's plots.
 */
export function visualOrderTargets(
  indicators: readonly SavedIndicator[],
  instanceId: string,
): VisualOrderTargets | undefined {
  const pricePaneIds = pricePaneInstanceIds(indicators);
  const [frontInstanceId] = pricePaneIds;
  const backInstanceId = pricePaneIds.at(-1);
  if (!pricePaneIds.includes(instanceId) || frontInstanceId === undefined || backInstanceId === undefined) {
    return undefined;
  }
  return { frontInstanceId, backInstanceId };
}
