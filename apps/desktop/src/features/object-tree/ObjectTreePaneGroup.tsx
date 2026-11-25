import type { ReactNode } from 'react';

/** The label of the group holding the price pane's rows: the drawings, the price bars and its indicators. */
export const PRICE_PANE_GROUP_LABEL = 'Price pane';

/**
 * The label of the price pane's list, one list holding the drawings, the price bars and the price-pane indicators:
 * every row paints over the ones under it, and the bars row marks where the candles stand among them.
 */
export const PRICE_PANE_LIST_LABEL = 'Drawings and indicators';

/** The label of a group's pane, numbered from the price pane as pane 1: 'Pane 2', 'Pane 3' and so on. */
export function paneGroupLabel(paneNumber: number): string {
  return `Pane ${paneNumber}`;
}

/**
 * One group of object tree rows, as the chart stacks its panes. Like TradingView's object tree it shows no
 * heading: only a divider sets it apart from the group above, and its label names it to a screen reader.
 */
export function ObjectTreePaneGroup({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="object-tree-pane-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}
