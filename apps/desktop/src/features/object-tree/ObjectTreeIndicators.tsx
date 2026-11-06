import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import { ObjectTreeIndicatorRow } from './ObjectTreeIndicatorRow';
import { objectTreeIndicators } from './objectTreeIndicatorEntries';

/**
 * The indicator rows of the object tree, listed under the drawings in attach order and named as the
 * chart's legend names them. It renders nothing while the chart has no indicator on its price pane.
 */
export function ObjectTreeIndicators() {
  const { settings } = useChartSettings();
  const indicators = objectTreeIndicators(settings.indicators);
  if (indicators.length === 0) {
    return null;
  }
  return (
    <ul className="object-tree-list object-tree-indicator-list" aria-label="Indicators">
      {indicators.map(({ saved, plugin }) => (
        <ObjectTreeIndicatorRow key={saved.instanceId} saved={saved} plugin={plugin} />
      ))}
    </ul>
  );
}
