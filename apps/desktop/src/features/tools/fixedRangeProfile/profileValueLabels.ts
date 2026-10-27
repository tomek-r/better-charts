import { formatCompactNumber } from '../../../shared/compactNumber';
import type { ProfileBarsLayout, RowWeights } from './profileBars';
import type { FixedRangeProfileAppearance, FixedRangeProfileVolumeMode } from './settings';

const VALUE_FONT = '400 11px system-ui, sans-serif';
/** A row shorter than the font would stack its text on its neighbours', so no row is labelled below this. */
const MIN_LABELLED_ROW_HEIGHT = 11;
const ANCHOR_INSET = 4;
const SUMMARY_GAP = 4;

type WeightsText = (weights: RowWeights) => string;

// Down is drawn left of up in the mirrored bars, so the text reads in the same order.
const VALUE_TEXT_BY_MODE: Readonly<Record<FixedRangeProfileVolumeMode, WeightsText>> = {
  upDown: ({ up, down }) => `${formatCompactNumber(down)}×${formatCompactNumber(up)}`,
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
}

const NOTHING_PAINTED: PaintedValueLabels = { rowLabels: 0 };

function isRowLabelled({ weights }: ProfileBarsLayout['rows'][number]): boolean {
  return weights.up + weights.down > 0;
}

/**
 * Paints each row's volumes at the bars' anchor edge and the totals 4px under the lowest row. Rows too short to
 * hold the text get no label, rather than overlapping ones; the totals still show. Draws nothing when Values is off.
 */
export function drawProfileValueLabels(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  { rows }: ProfileBarsLayout,
  appearance: FixedRangeProfileAppearance,
): PaintedValueLabels {
  if (!appearance.valuesVisible || rows.length === 0) {
    return NOTHING_PAINTED;
  }
  const isRight = appearance.placement === 'right';
  const textX = isRight ? anchorX - ANCHOR_INSET : anchorX + ANCHOR_INSET;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = appearance.valuesColor;
  ctx.font = VALUE_FONT;
  ctx.textAlign = isRight ? 'right' : 'left';

  const shortestRow = Math.min(...rows.map((row) => row.bottom - row.top));
  const labelledRows = shortestRow >= MIN_LABELLED_ROW_HEIGHT ? rows.filter(isRowLabelled) : [];
  ctx.textBaseline = 'middle';
  for (const row of labelledRows) {
    ctx.fillText(rowValueText(appearance.volumeMode, row.weights), textX, (row.top + row.bottom) / 2);
  }

  const summaryY = Math.max(...rows.map((row) => row.bottom)) + SUMMARY_GAP;
  ctx.textBaseline = 'top';
  ctx.fillText(summaryValueText(appearance.volumeMode, rows), textX, summaryY);
  ctx.restore();
  return { rowLabels: labelledRows.length, summaryY };
}
