import { useBridgeChartState } from '../bridge/bridgeSelectors';
import { timeframeLabel } from '../../shared/bridge/timeframes';
import { CandlesIcon } from './CandlesIcon';
import { ROW_NAME_CLASS } from './objectTreeRowFocus';
import type { LayerRowReorder } from './useLayerReorder';

/** The row's name while the chart has no symbol yet. */
const FALLBACK_BARS_LABEL = 'Price bars';

/** What the row calls the chart's series: "EURUSD, 1H", or the bare symbol before a timeframe is known. */
function barsLabel(symbol: string | undefined, timeframe: string | undefined): string {
  if (symbol === undefined) {
    return FALLBACK_BARS_LABEL;
  }
  return timeframe === undefined ? symbol : `${symbol}, ${timeframeLabel(timeframe)}`;
}

/**
 * The price bars in the object tree, at their place in the stacking order: drawings listed below this
 * row paint under the candles. It takes the same drag and keys as a drawing row but has no actions.
 */
export function ObjectTreeBarsRow({ reorder }: { readonly reorder: LayerRowReorder }) {
  const { symbol, timeframe } = useBridgeChartState();
  const label = barsLabel(symbol, timeframe);

  return (
    <li className="object-tree-row object-tree-bars-row" data-layer="bars" {...reorder.listItemProps}>
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
    </li>
  );
}
