import type { ChartIndicatorDefinition } from '../chart/engine/indicators/indicatorContract';

/**
 * A chart indicator as the app lists it: the engine's behavior
 * (`ChartIndicatorDefinition`) plus how the Indicators list presents it. The
 * engine never sees the presentation part.
 */
export type ChartIndicatorPlugin<Id extends string = string> = ChartIndicatorDefinition & {
  readonly id: Id;
  /** The name the Indicators list and the Object tree show, e.g. "Moving Average Simple". */
  readonly title: string;
  /** What the legend writes before the inputs, e.g. "SMA". */
  readonly shortTitle: string;
};
