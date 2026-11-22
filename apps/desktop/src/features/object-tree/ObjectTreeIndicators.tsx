import type { ReactNode, RefObject } from 'react';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import { useIndicatorRowCommands } from '../indicators/useIndicatorCommands';
import { ObjectTreeIndicatorRow } from './ObjectTreeIndicatorRow';
import { ObjectTreePaneGroup, paneGroupLabel } from './ObjectTreePaneGroup';
import { objectTreeIndicatorPanes } from './objectTreeIndicatorEntries';
import { useLayerReorder } from './useLayerReorder';

/** The price pane counts as pane 1, and the chart stacks a new own pane under the ones already there. */
const FIRST_OWN_PANE = 2;

interface ObjectTreeIndicatorListProps {
  readonly children: ReactNode;
  /** The list a moved row's focus is handed back through; absent for an own pane's list, whose row stays put. */
  readonly listRef?: RefObject<HTMLUListElement | null>;
}

/** The rows of one pane, in a list of their own, named as the chart's legend names them. */
function ObjectTreeIndicatorList({ children, listRef }: ObjectTreeIndicatorListProps) {
  return (
    <ul ref={listRef} className="object-tree-list object-tree-indicator-list" aria-label="Indicators">
      {children}
    </ul>
  );
}

/**
 * The indicator rows of the price pane, listed under the drawings, their top row painting over the ones
 * under it: a drag or Alt+Arrow moves one indicator among them and saves the order. It renders nothing
 * while the pane has no row.
 */
export function ObjectTreePricePaneIndicators() {
  const { settings } = useChartSettings();
  const { moveIndicatorRow } = useIndicatorRowCommands();
  const { pricePane } = objectTreeIndicatorPanes(settings.indicators);
  const moveRow = (fromIndex: number, toIndex: number) => {
    const moved = pricePane[fromIndex];
    const target = pricePane[toIndex];
    if (moved === undefined || target === undefined) {
      return;
    }
    moveIndicatorRow(moved.saved.instanceId, target.saved.instanceId);
  };
  const { forRow, listRef } = useLayerReorder(pricePane.length, moveRow);

  if (pricePane.length === 0) {
    return null;
  }
  return (
    <ObjectTreeIndicatorList listRef={listRef}>
      {pricePane.map(({ saved, plugin }, rowIndex) => (
        <ObjectTreeIndicatorRow key={saved.instanceId} saved={saved} plugin={plugin} reorder={forRow(rowIndex)} />
      ))}
    </ObjectTreeIndicatorList>
  );
}

/**
 * One group per indicator that has a pane of its own, in the order its pane stands under the price pane,
 * each group holding that indicator's row.
 */
export function ObjectTreeOwnPaneIndicators() {
  const { settings } = useChartSettings();
  const { ownPanes } = objectTreeIndicatorPanes(settings.indicators);
  return (
    <>
      {ownPanes.map(({ saved, plugin }, ownPaneIndex) => (
        <ObjectTreePaneGroup key={saved.instanceId} label={paneGroupLabel(FIRST_OWN_PANE + ownPaneIndex)}>
          <ObjectTreeIndicatorList>
            <ObjectTreeIndicatorRow saved={saved} plugin={plugin} />
          </ObjectTreeIndicatorList>
        </ObjectTreePaneGroup>
      ))}
    </>
  );
}
