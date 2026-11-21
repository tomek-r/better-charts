import type { ChartIndicator } from '../../chart/engine/indicators/indicatorContract';
import type { ChartIndicatorPlugin } from '../chartIndicatorPlugin';
import { calculationInputs } from './calculationInputs';
import { HigherTimeframeIndicator } from './higherTimeframeIndicator';

/** The plugin's own indicator, calculated through the higher-timeframe wrapper. */
function calculationIndicatorClass(indicatorClass: new () => ChartIndicator): new () => ChartIndicator {
  return class extends HigherTimeframeIndicator {
    constructor() {
      super(indicatorClass);
    }
  };
}

/**
 * The plugin as the chart registers it: its own inputs, styles and behavior, plus the Calculation section
 * every built-in indicator carries and the wrapper that calculates a higher timeframe from the chart's bars.
 */
export function withCalculation<Id extends string>(plugin: ChartIndicatorPlugin<Id>): ChartIndicatorPlugin<Id> {
  return {
    ...plugin,
    inputs: [...(plugin.inputs ?? []), ...calculationInputs()],
    indicatorClass: calculationIndicatorClass(plugin.indicatorClass),
  };
}
