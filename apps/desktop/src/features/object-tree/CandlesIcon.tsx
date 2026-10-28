import { OutlineIcon } from '../../shared/ui/icons/OutlineIcon';

/** The class of a row glyph, which object-tree.css sizes like the tool icons beside it. */
const ICON_CLASS = 'object-tree-row-icon';

/** Two candle bodies with their wicks: the chart's own series, the row the drawings stack around. */
const CANDLES_GLYPH = (
  <>
    <path d="M8 3v3M8 15v6M16 3v6M16 18v3" />
    <rect x="5.5" y="6" width="5" height="9" rx="1" />
    <rect x="13.5" y="9" width="5" height="9" rx="1" />
  </>
);

/** The price bars of the chart. */
export function CandlesIcon() {
  return <OutlineIcon className={ICON_CLASS}>{CANDLES_GLYPH}</OutlineIcon>;
}
