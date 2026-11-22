import type { SavedIndicator } from '../../chart/chartSettings/savedIndicators';
import { findChartIndicatorPlugin } from '../registry';

/**
 * Where each paint-order command moves an indicator: the row it takes among the price pane's plots. A command
 * that would leave the order as it is, because the indicator already holds that row or has no plot beside it
 * that way, names no row.
 */
export interface VisualOrderTargets {
  readonly frontInstanceId: string | undefined;
  readonly forwardInstanceId: string | undefined;
  readonly backwardInstanceId: string | undefined;
  readonly backInstanceId: string | undefined;
}

/** The price-pane indicators' instance ids, in the saved order the chart paints them in. */
function pricePaneInstanceIds(indicators: readonly SavedIndicator[]): string[] {
  return indicators.flatMap((indicator) =>
    findChartIndicatorPlugin(indicator.definitionId)?.pane === 'overlay' ? [indicator.instanceId] : [],
  );
}

/** The row a command moves the indicator to, or undefined when that row is the one it holds already. */
function targetOtherThan(targetInstanceId: string | undefined, instanceId: string): string | undefined {
  return targetInstanceId === instanceId ? undefined : targetInstanceId;
}

/**
 * The rows the four paint-order commands move an indicator to, or undefined for one with a pane of its own: the
 * pane has a place of its own under the price pane, so it has no paint order among the price pane's plots.
 */
export function visualOrderTargets(
  indicators: readonly SavedIndicator[],
  instanceId: string,
): VisualOrderTargets | undefined {
  const pricePaneIds = pricePaneInstanceIds(indicators);
  const ownIndex = pricePaneIds.indexOf(instanceId);
  if (ownIndex === -1) {
    return undefined;
  }
  const forwardInstanceId = ownIndex === 0 ? undefined : pricePaneIds.at(ownIndex - 1);
  return {
    frontInstanceId: targetOtherThan(pricePaneIds.at(0), instanceId),
    forwardInstanceId: targetOtherThan(forwardInstanceId, instanceId),
    backwardInstanceId: targetOtherThan(pricePaneIds.at(ownIndex + 1), instanceId),
    backInstanceId: targetOtherThan(pricePaneIds.at(-1), instanceId),
  };
}
