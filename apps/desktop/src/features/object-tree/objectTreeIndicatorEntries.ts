import type { SavedIndicator } from '../chart/chartSettings/savedIndicators';
import { findChartIndicatorPlugin, type RegisteredChartIndicatorPlugin } from '../indicators/registry';

/** One saved indicator the object tree lists, with the registry entry that names and edits it. */
export interface ObjectTreeIndicator {
  readonly saved: SavedIndicator;
  readonly plugin: RegisteredChartIndicatorPlugin;
}

/**
 * The saved indicators the object tree lists, in attach order. By the owner's decision only the
 * registered definitions drawn on the price pane get a row: an indicator with a pane of its own such as
 * RSI or MACD has no place under the drawings.
 */
export function objectTreeIndicators(saved: readonly SavedIndicator[]): ObjectTreeIndicator[] {
  return saved.flatMap((entry) => {
    const plugin = findChartIndicatorPlugin(entry.definitionId);
    if (plugin === undefined || plugin.pane !== 'overlay') {
      return [];
    }
    return [{ saved: entry, plugin }];
  });
}
