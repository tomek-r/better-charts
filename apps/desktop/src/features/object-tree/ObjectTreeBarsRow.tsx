import type { ToggleCommandLabels } from '../../shared/ui/button/ToggleCommandButton';
import { useBridgeChartState } from '../bridge/bridgeSelectors';
import { withPriceBarsHidden } from '../chart/chartSettings/chartSettings';
import { useChartSettings } from '../chart/chartSettings/ChartSettingsProvider';
import { timeframeLabel } from '../../shared/bridge/timeframes';
import { CandlesIcon } from './CandlesIcon';
import { ObjectTreeVisibilityButton } from './objectTreeRowActions';
import { presentWhileTrue } from './objectTreeRowAttributes';
import { ROW_NAME_CLASS } from './objectTreeRowFocus';
import type { RowReorder } from './useLayerReorder';

/** The row's name while the chart has no symbol yet. */
const FALLBACK_BARS_LABEL = 'Price bars';

/** The labels of the row's only action, each naming the state it leads to. */
const PRICE_BARS_VISIBILITY_LABELS: ToggleCommandLabels = { off: 'Hide price bars', on: 'Show price bars' };

/** What the row calls the chart's series: "EURUSD, 1H", or the bare symbol before a timeframe is known. */
function barsLabel(symbol: string | undefined, timeframe: string | undefined): string {
  if (symbol === undefined) {
    return FALLBACK_BARS_LABEL;
  }
  return timeframe === undefined ? symbol : `${symbol}, ${timeframeLabel(timeframe)}`;
}

/**
 * The price bars in the object tree, at their place in the stacking order: a drawing or an indicator listed below
 * this row paints under the candles, and one above it paints over them. It takes the same drag and keys as every
 * other row, so a drag or Alt+Arrow crosses it into the price-pane indicator rows, and its one button hides the bars
 * from the chart and shows them again; a hidden row's name is dimmed like a drawing's.
 */
export function ObjectTreeBarsRow({ reorder }: { readonly reorder: RowReorder }) {
  const { symbol, timeframe } = useBridgeChartState();
  const { settings, keep } = useChartSettings();
  const label = barsLabel(symbol, timeframe);
  const hidden = settings.priceBarsHidden;

  return (
    <li
      className="object-tree-row object-tree-bars-row"
      data-layer="bars"
      data-hidden={presentWhileTrue(hidden)}
      {...reorder.listItemProps}
    >
      <button
        type="button"
        className={ROW_NAME_CLASS}
        aria-label={label}
        aria-roledescription="price bars"
        onKeyDown={reorder.onNameKeyDown}
      >
        <CandlesIcon />
        <span className="object-tree-row-label">{label}</span>
      </button>
      <div className="object-tree-row-actions">
        <ObjectTreeVisibilityButton
          labels={PRICE_BARS_VISIBILITY_LABELS}
          hidden={hidden}
          onToggle={() => keep(withPriceBarsHidden(settings, !hidden))}
        />
      </div>
    </li>
  );
}
