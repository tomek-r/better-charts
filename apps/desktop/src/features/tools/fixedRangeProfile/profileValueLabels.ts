import { formatCompactNumber } from '../../../shared/compactNumber';
import type { ProfileBarsLayout, RowWeights } from './profileBars';
import type { FixedRangeProfileAppearance, FixedRangeProfileVolumeMode } from './fixedRangeProfileSettings';

/** The largest text the profile paints: value labels in tall rows and the bar timeframe label. */
export const MAX_VALUE_FONT_PX = 11;
const MIN_FONT_PX = 1;
const ANCHOR_INSET = 4;
const SUMMARY_GAP = 4;

export function valueFont(sizePx: number): string {
  return `400 ${sizePx}px system-ui, sans-serif`;
}

/** One pixel less than the row, so text centred in a short row stays inside it. */
function rowFontPx(row: ProfileBarsLayout['rows'][number]): number {
  return Math.max(MIN_FONT_PX, Math.min(MAX_VALUE_FONT_PX, row.bottom - row.top - 1));
}

type WeightsText = (weights: RowWeights) => string;

// Up before down, the order TradingView's volume profile labels its rows.
const VALUE_TEXT_BY_MODE: Readonly<Record<FixedRangeProfileVolumeMode, WeightsText>> = {
  upDown: ({ up, down }) => `${formatCompactNumber(up)}×${formatCompactNumber(down)}`,
  total: ({ up, down }) => formatCompactNumber(up + down),
  delta: ({ up, down }) => formatCompactNumber(up - down),
};

/** The label of one row in the given volume mode. */
export function rowValueText(mode: FixedRangeProfileVolumeMode, weights: RowWeights): string {
  return VALUE_TEXT_BY_MODE[mode](weights);
}

/** The totals line: the same format as a row, over the sum of every row. */
export function summaryValueText(mode: FixedRangeProfileVolumeMode, rows: ProfileBarsLayout['rows']): string {
  const totals = rows.reduce((sum, { weights }) => ({ up: sum.up + weights.up, down: sum.down + weights.down }), {
    up: 0,
    down: 0,
  });
  return rowValueText(mode, totals);
}

/** What the value labels painted, for the dev hook and tests. */
export interface PaintedValueLabels {
  readonly rowLabels: number;
  readonly summaryY?: number;
  readonly textX?: number;
  readonly textAlign?: CanvasTextAlign;
}

const NOTHING_PAINTED: PaintedValueLabels = { rowLabels: 0 };

/** The x edges of the range box the labels sit inside. */
export interface RangeEdges {
  readonly startX: number;
  readonly endX: number;
}

/** The label x and alignment: 4px inside the chosen edge, text running away from it into the box. */
function labelAnchor(
  { startX, endX }: RangeEdges,
  { placement, valuesSide }: FixedRangeProfileAppearance,
): { textX: number; textAlign: CanvasTextAlign } {
  const atEnd = (placement === 'right') === (valuesSide === 'profile');
  return atEnd
    ? { textX: endX - ANCHOR_INSET, textAlign: 'right' }
    : { textX: startX + ANCHOR_INSET, textAlign: 'left' };
}

function isRowLabelled({ weights }: ProfileBarsLayout['rows'][number]): boolean {
  return weights.up + weights.down > 0;
}

/**
 * Paints each non-empty row's volumes at the bars' edge (or the opposite edge) of the range box and the totals 4px
 * under the lowest row, on the same side. Each row's font shrinks with its height so labels never overlap; the
 * totals use the smallest row font. Draws nothing when Values is off.
 */
export function drawProfileValueLabels(
  ctx: CanvasRenderingContext2D,
  edges: RangeEdges,
  { rows }: ProfileBarsLayout,
  appearance: FixedRangeProfileAppearance,
): PaintedValueLabels {
  if (!appearance.valuesVisible || rows.length === 0) {
    return NOTHING_PAINTED;
  }
  const { textX, textAlign } = labelAnchor(edges, appearance);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = appearance.valuesColor;
  ctx.textAlign = textAlign;

  const labelledRows = rows.filter(isRowLabelled);
  ctx.textBaseline = 'middle';
  for (const row of labelledRows) {
    ctx.font = valueFont(rowFontPx(row));
    ctx.fillText(rowValueText(appearance.volumeMode, row.weights), textX, (row.top + row.bottom) / 2);
  }

  const summaryY = Math.max(...rows.map((row) => row.bottom)) + SUMMARY_GAP;
  ctx.font = valueFont(Math.min(...rows.map(rowFontPx)));
  ctx.textBaseline = 'top';
  ctx.fillText(summaryValueText(appearance.volumeMode, rows), textX, summaryY);
  ctx.restore();
  return { rowLabels: labelledRows.length, summaryY, textX, textAlign };
}
