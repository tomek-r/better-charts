import { formatCompactNumber } from '../../../shared/compactNumber';
import { isFullyTransparent } from '../../../shared/theme/hexColor';
import type { ProfileBarsLayout, RowWeights } from './profileBars';
import type { FixedRangeProfileAppearance, FixedRangeProfileVolumeMode } from './fixedRangeProfileSettings';

/** The largest text the profile paints: value labels in tall rows and the bar timeframe label. */
export const MAX_VALUE_FONT_PX = 11;
const MIN_FONT_PX = 1;
const LINE_GAP = 4;
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

/** Where the box behind the labels column is, in canvas pixels. */
interface ValuesBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** What the value labels painted, for the dev hook and tests. */
export interface PaintedValueLabels {
  readonly rowLabels: number;
  readonly summaryY?: number;
  readonly textX?: number;
  readonly textAlign?: CanvasTextAlign;
  /** The box painted behind the labels; absent when Values Background is fully transparent. */
  readonly box?: ValuesBox;
}

const NOTHING_PAINTED: PaintedValueLabels = { rowLabels: 0 };

/** Which way the text runs from the anchor line, and the signed gap from the line to where it starts. */
const LABEL_PLACEMENT_BY_SIDE: Readonly<
  Record<FixedRangeProfileAppearance['valuesSide'], { textAlign: CanvasTextAlign; offset: number }>
> = {
  left: { textAlign: 'right', offset: -LINE_GAP },
  right: { textAlign: 'left', offset: LINE_GAP },
};

/** The label x and alignment: 4px beside the anchor line, text running away from it. */
function labelAnchor(
  anchorX: number,
  { valuesSide }: FixedRangeProfileAppearance,
): { textX: number; textAlign: CanvasTextAlign } {
  const { textAlign, offset } = LABEL_PLACEMENT_BY_SIDE[valuesSide];
  return { textX: anchorX + offset, textAlign };
}

function isRowLabelled({ weights }: ProfileBarsLayout['rows'][number]): boolean {
  return weights.up + weights.down > 0;
}

interface LabelText {
  readonly text: string;
  readonly fontPx: number;
}

/** The widest of the texts, each measured in its own font. */
function widestTextWidth(ctx: CanvasRenderingContext2D, labels: readonly LabelText[]): number {
  return Math.max(
    ...labels.map(({ text, fontPx }) => {
      ctx.font = valueFont(fontPx);
      return ctx.measureText(text).width;
    }),
  );
}

interface LabelColumn {
  readonly anchorX: number;
  readonly textX: number;
  readonly appearance: FixedRangeProfileAppearance;
  readonly labelledRows: ProfileBarsLayout['rows'];
  readonly summary: LabelText;
  readonly summaryY: number;
}

/**
 * The box behind the labels column: from the anchor line to LINE_GAP past the widest text on the labels' side,
 * from the highest labelled row to the bottom of the totals line.
 */
function valuesBoxOf(
  ctx: CanvasRenderingContext2D,
  { anchorX, textX, appearance, labelledRows, summary, summaryY }: LabelColumn,
): ValuesBox {
  const rowLabels = labelledRows.map((row) => ({
    text: rowValueText(appearance.volumeMode, row.weights),
    fontPx: rowFontPx(row),
  }));
  const reach = widestTextWidth(ctx, [...rowLabels, summary]) + LINE_GAP;
  const top = Math.min(summaryY, ...labelledRows.map((row) => row.top));
  const bottom = summaryY + summary.fontPx;
  return appearance.valuesSide === 'right'
    ? { left: anchorX, right: textX + reach, top, bottom }
    : { left: textX - reach, right: anchorX, top, bottom };
}

function drawValuesBox(ctx: CanvasRenderingContext2D, { left, right, top, bottom }: ValuesBox, color: string): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.restore();
}

/**
 * Paints each non-empty row's volumes 4px left or right of the anchor line and the totals 4px under the lowest
 * row, on the same side. Each row's font shrinks with its height so labels never overlap; the totals use the
 * smallest row font. A non-transparent Values Background first fills one box from the anchor line to 4px past the
 * widest text, from the highest labelled row to the bottom of the totals line. Draws nothing when Values is off.
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
  const { textX, textAlign } = labelAnchor(anchorX, appearance);
  const labelledRows = rows.filter(isRowLabelled);
  const summaryY = Math.max(...rows.map((row) => row.bottom)) + SUMMARY_GAP;
  const summary: LabelText = {
    text: summaryValueText(appearance.volumeMode, rows),
    fontPx: Math.min(...rows.map(rowFontPx)),
  };

  ctx.save();
  ctx.globalAlpha = 1;
  const box = isFullyTransparent(appearance.valuesBackgroundColor)
    ? undefined
    : valuesBoxOf(ctx, { anchorX, textX, appearance, labelledRows, summary, summaryY });
  if (box !== undefined) {
    drawValuesBox(ctx, box, appearance.valuesBackgroundColor);
  }

  ctx.fillStyle = appearance.valuesColor;
  ctx.textAlign = textAlign;
  ctx.textBaseline = 'middle';
  for (const row of labelledRows) {
    ctx.font = valueFont(rowFontPx(row));
    ctx.fillText(rowValueText(appearance.volumeMode, row.weights), textX, (row.top + row.bottom) / 2);
  }
  ctx.font = valueFont(summary.fontPx);
  ctx.textBaseline = 'top';
  ctx.fillText(summary.text, textX, summaryY);
  ctx.restore();
  return { rowLabels: labelledRows.length, summaryY, textX, textAlign, box };
}
