import { formatCompactNumber } from '../../../shared/compactNumber';
import { isFullyTransparent } from '../../../shared/theme/hexColor';
import type { ProfileBarsLayout, RowWeights } from './profileBars';
import type { FixedRangeProfileAppearance, FixedRangeProfileVolumeMode } from './fixedRangeProfileSettings';

/** The largest text the profile paints: value labels in tall rows and the bar timeframe label. */
export const MAX_VALUE_FONT_PX = 11;
const MIN_FONT_PX = 1;
const LINE_GAP = 4;
const HEADER_GAP = 4;
/** Names the two numbers of an Up/Down label, in the order they are written. */
const UP_DOWN_HEADER = 'Bid×Ask';

export function valueFont(sizePx: number): string {
  return `400 ${sizePx}px system-ui, sans-serif`;
}

/** One pixel less than the row, so text centred in a short row stays inside it. */
function rowFontPx(row: ProfileBarsLayout['rows'][number]): number {
  return Math.max(MIN_FONT_PX, Math.min(MAX_VALUE_FONT_PX, row.bottom - row.top - 1));
}

type WeightsText = (weights: RowWeights) => string;

interface ValueLabelsOfMode {
  readonly text: WeightsText;
  /** Whether Bid×Ask headers name the two numbers of a label. */
  readonly hasHeaders: boolean;
}

// Bid (down) before ask (up), the same left-to-right order as the bars: down hangs left of the line, up right.
const VALUE_LABELS_BY_MODE: Readonly<Record<FixedRangeProfileVolumeMode, ValueLabelsOfMode>> = {
  upDown: {
    text: ({ up, down }) => `${formatCompactNumber(down)}×${formatCompactNumber(up)}`,
    hasHeaders: true,
  },
  total: { text: ({ up, down }) => formatCompactNumber(up + down), hasHeaders: false },
  delta: { text: ({ up, down }) => formatCompactNumber(up - down), hasHeaders: false },
};

/** The label of one row in the given volume mode. */
export function rowValueText(mode: FixedRangeProfileVolumeMode, weights: RowWeights): string {
  return VALUE_LABELS_BY_MODE[mode].text(weights);
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
  /** Baselines of the Bid×Ask headers above and under the column; absent outside Up/Down. */
  readonly headerTopY?: number;
  readonly headerBottomY?: number;
  readonly textX?: number;
  readonly textAlign?: CanvasTextAlign;
  /** The area the labels and headers cover, for hit testing; painted as the box when there is a background. */
  readonly column?: ValuesBox;
  /** The box painted behind the labels; absent when Values Background is fully transparent. */
  readonly box?: ValuesBox;
}

const NOTHING_PAINTED: PaintedValueLabels = { rowLabels: 0 };

/** The values column, as far as the anchor line decides: where its centre is and the box's left and right edges. */
interface ColumnPlacement {
  readonly centerX: number;
  readonly boxLeft: number;
  readonly boxRight: number;
}

/**
 * The column is as wide as its widest text and every text is centred in it. Right starts LINE_GAP right of the
 * anchor line, Left ends LINE_GAP left of it, Center straddles it; the box reaches LINE_GAP past the column.
 */
const COLUMN_PLACEMENT_BY_SIDE: Readonly<
  Record<FixedRangeProfileAppearance['valuesSide'], (anchorX: number, columnWidth: number) => ColumnPlacement>
> = {
  left: (anchorX, columnWidth) => {
    const centerX = anchorX - LINE_GAP - columnWidth / 2;
    return { centerX, boxLeft: centerX - columnWidth / 2 - LINE_GAP, boxRight: anchorX };
  },
  center: (anchorX, columnWidth) => ({
    centerX: anchorX,
    boxLeft: anchorX - (columnWidth / 2 + LINE_GAP),
    boxRight: anchorX + (columnWidth / 2 + LINE_GAP),
  }),
  right: (anchorX, columnWidth) => {
    const centerX = anchorX + LINE_GAP + columnWidth / 2;
    return { centerX, boxLeft: anchorX, boxRight: centerX + columnWidth / 2 + LINE_GAP };
  },
};

const TEXT_ALIGN: CanvasTextAlign = 'center';

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

/** The Bid×Ask header baselines, present only in Up/Down. */
interface HeaderYs {
  readonly headerTopY: number;
  readonly headerBottomY: number;
}

/** Where the labels column reaches vertically, headers included. */
interface ColumnExtent extends Partial<HeaderYs> {
  readonly top: number;
  readonly bottom: number;
}

interface ColumnShape {
  readonly labelledRows: ProfileBarsLayout['rows'];
  readonly lowestRowBottom: number;
  /** The font of the headers: the smallest row font. */
  readonly smallFontPx: number;
  readonly hasHeaders: boolean;
}

/**
 * From the highest labelled row to the bottom of the lowest row. A header sits HEADER_GAP above the first and
 * under the second, and the column grows by the header's height at each end.
 */
function columnExtentOf({ labelledRows, lowestRowBottom, smallFontPx, hasHeaders }: ColumnShape): ColumnExtent {
  const highestTop = Math.min(lowestRowBottom, ...labelledRows.map((row) => row.top));
  if (!hasHeaders) {
    return { top: highestTop, bottom: lowestRowBottom };
  }
  const headerTopY = highestTop - HEADER_GAP;
  const headerBottomY = lowestRowBottom + HEADER_GAP;
  return { top: headerTopY - smallFontPx, bottom: headerBottomY + smallFontPx, headerTopY, headerBottomY };
}

function drawValuesBox(ctx: CanvasRenderingContext2D, { left, right, top, bottom }: ValuesBox, color: string): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.fillRect(left, top, right - left, bottom - top);
  ctx.restore();
}

function drawHeader(ctx: CanvasRenderingContext2D, textX: number, y: number, baseline: CanvasTextBaseline): void {
  ctx.textBaseline = baseline;
  ctx.fillText(UP_DOWN_HEADER, textX, y);
}

/**
 * Paints each non-empty row's volumes in one column, every text centred in it; the column sits 4px left or right
 * of the anchor line or is centred on it, and is as wide as its widest text. Up/Down adds a Bid×Ask
 * header 4px above the highest labelled row and another 4px under the lowest row, in the smallest row font.
 * Each row's font shrinks with its height so labels never overlap.
 * A non-transparent Values Background first fills one box around the column, headers included, 4px past the widest
 * text. Draws nothing when Values is off.
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
  const labelledRows = rows.filter(isRowLabelled);
  const lowestRowBottom = Math.max(...rows.map((row) => row.bottom));
  const smallFontPx = Math.min(...rows.map(rowFontPx));
  const { hasHeaders } = VALUE_LABELS_BY_MODE[appearance.volumeMode];
  const extent = columnExtentOf({ labelledRows, lowestRowBottom, smallFontPx, hasHeaders });
  const texts = [
    ...labelledRows.map((row) => ({ text: rowValueText(appearance.volumeMode, row.weights), fontPx: rowFontPx(row) })),
    ...(hasHeaders ? [{ text: UP_DOWN_HEADER, fontPx: smallFontPx }] : []),
  ];

  ctx.save();
  ctx.globalAlpha = 1;
  const {
    centerX: textX,
    boxLeft,
    boxRight,
  } = COLUMN_PLACEMENT_BY_SIDE[appearance.valuesSide](anchorX, widestTextWidth(ctx, texts));
  const column: ValuesBox = { left: boxLeft, right: boxRight, top: extent.top, bottom: extent.bottom };
  const box = isFullyTransparent(appearance.valuesBackgroundColor) ? undefined : column;
  if (box !== undefined) {
    drawValuesBox(ctx, box, appearance.valuesBackgroundColor);
  }

  ctx.fillStyle = appearance.valuesColor;
  ctx.textAlign = TEXT_ALIGN;
  ctx.textBaseline = 'middle';
  for (const row of labelledRows) {
    ctx.font = valueFont(rowFontPx(row));
    ctx.fillText(rowValueText(appearance.volumeMode, row.weights), textX, (row.top + row.bottom) / 2);
  }
  ctx.font = valueFont(smallFontPx);
  const { headerTopY, headerBottomY } = extent;
  if (headerTopY !== undefined && headerBottomY !== undefined) {
    drawHeader(ctx, textX, headerTopY, 'bottom');
    drawHeader(ctx, textX, headerBottomY, 'top');
  }
  ctx.restore();
  return {
    rowLabels: labelledRows.length,
    headerTopY,
    headerBottomY,
    textX,
    textAlign: TEXT_ALIGN,
    column,
    box,
  };
}
