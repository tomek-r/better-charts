import type { ChartIndicator } from '../../chart/engine/indicators/indicatorContract';
import type { ChartIndicatorPlugin } from '../chartIndicatorPlugin';
import { CalculationIndicator } from './calculationIndicator';
import { calculationInputs } from './calculationInputs';

/** The plugin's own indicator, calculated through the timeframe wrapper. */
function calculationIndicatorClass(indicatorClass: new () => ChartIndicator): new () => ChartIndicator {
  return class extends CalculationIndicator {
    constructor() {
      super(indicatorClass);
    }
  };
}

/**
 * The plugin as the chart registers it: its own inputs, styles and behavior, plus the Calculation section
 * every built-in indicator carries and the wrapper that calculates another timeframe than the chart's.
 */
export function withCalculation<Id extends string>(plugin: ChartIndicatorPlugin<Id>): ChartIndicatorPlugin<Id> {
  return {
    ...plugin,
    inputs: [...(plugin.inputs ?? []), ...calculationInputs()],
    indicatorClass: calculationIndicatorClass(plugin.indicatorClass),
  };
}
