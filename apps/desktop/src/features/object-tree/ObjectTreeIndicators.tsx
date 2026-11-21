import type { ReactNode } from 'react';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import { ObjectTreeIndicatorRow } from './ObjectTreeIndicatorRow';
import { ObjectTreePaneGroup, paneGroupLabel } from './ObjectTreePaneGroup';
import { objectTreeIndicatorPanes } from './objectTreeIndicatorEntries';

/** The price pane counts as pane 1, and the chart stacks a new own pane under the ones already there. */
const FIRST_OWN_PANE = 2;

/** The rows of one pane, in a list of their own, named as the chart's legend names them. */
function ObjectTreeIndicatorList({ children }: { readonly children: ReactNode }) {
  return (
    <ul className="object-tree-list object-tree-indicator-list" aria-label="Indicators">
      {children}
    </ul>
  );
}

/** The indicator rows of the price pane, listed under the drawings; it renders nothing while it has none. */
export function ObjectTreePricePaneIndicators() {
  const { settings } = useChartSettings();
  const { pricePane } = objectTreeIndicatorPanes(settings.indicators);
  if (pricePane.length === 0) {
    return null;
  }
  return (
    <ObjectTreeIndicatorList>
      {pricePane.map(({ saved, plugin }) => (
        <ObjectTreeIndicatorRow key={saved.instanceId} saved={saved} plugin={plugin} />
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
