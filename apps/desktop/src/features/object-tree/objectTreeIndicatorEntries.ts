import type { SavedIndicator } from '../chart/chartSettings/savedIndicators';
import { findChartIndicatorPlugin, type RegisteredChartIndicatorPlugin } from '../indicators/registry';

/** One saved indicator the object tree lists, with the registry entry that names and edits it. */
export interface ObjectTreeIndicator {
  readonly saved: SavedIndicator;
  readonly plugin: RegisteredChartIndicatorPlugin;
}

/** The rows of the object tree, grouped the way the chart stacks its panes. */
export interface ObjectTreeIndicatorPanes {
  /** The price pane's rows, in the saved order: they stand around the price bars, which the tree prints among them. */
  readonly pricePane: readonly ObjectTreeIndicator[];
  /** One row per indicator with a pane of its own, in the order its pane stands under the price pane. */
  readonly ownPanes: readonly ObjectTreeIndicator[];
}

/**
 * The saved indicators the object tree lists, split by the pane they draw in: an unregistered definition
 * gets no row at all. The chart stacks a new own pane under the existing ones, so the attach order of the
 * saved indicators is the order of those panes, top to bottom.
 */
export function objectTreeIndicatorPanes(saved: readonly SavedIndicator[]): ObjectTreeIndicatorPanes {
  const listed = saved.flatMap((entry) => {
    const plugin = findChartIndicatorPlugin(entry.definitionId);
    return plugin === undefined ? [] : [{ saved: entry, plugin }];
  });
  return {
    pricePane: listed.filter((entry) => entry.plugin.pane === 'overlay'),
    ownPanes: listed.filter((entry) => entry.plugin.pane === 'own'),
  };
}
