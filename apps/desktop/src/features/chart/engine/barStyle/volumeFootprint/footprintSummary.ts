import { palette } from '../../../../../shared/theme/palette';
import type { BarFootprint } from './footprintData';
import {
  footprintTextAlignOf,
  SINGLE_COLUMN_SIDE,
  type FootprintBarColumns,
  type FootprintCellBox,
  type FootprintColumn,
  type FootprintTextAlign,
} from './footprintGeometry';
import type { FootprintLayout, FootprintValues } from './footprintModes';
import type { FootprintSide } from './footprintShades';
import {
  footprintLineHeight,
  footprintTextFits,
  footprintTextScale,
  footprintTextWidthAt,
  footprintTextX,
  type FootprintTextStyle,
  type FootprintTextWeight,
} from './footprintTextSize';
import { footprintBarSides, type FootprintBarSides } from './footprintValues';
import { footprintSignedText, footprintVolumeText } from './footprintVolumeText';

/** The colour each side's volume total is written in under its own column: the sell side red, the buy side green. */
const SELL_TOTAL_COLOR = '#F23645';
const BUY_TOTAL_COLOR = '#089981';
/** The colour of a bar's delta when it traded more on the buy side, and when it traded more on the sell side. */
const DELTA_RISING_COLOR = '#089981';
const DELTA_FALLING_COLOR = '#F23645';
/** The colour of a delta that points nowhere, and of the volume total under it. */
const DELTA_FLAT_COLOR = palette.textTertiary;
const TOTAL_TEXT_COLOR = palette.textSecondary;
/** The fill and the outline of the box the two summary lines sit in. */
const SUMMARY_BOX_FILL = palette.panel;
const SUMMARY_BOX_BORDER = palette.borderStrong;
/** The labels the two lines start with, which the box's label column holds. */
const DELTA_LABEL = 'Delta';
const TOTAL_LABEL = 'Total';
/**
 * The faces the box's two pieces of text are measured in, which are the very ones the media pass draws them in: the
 * labels regular and the values bold, which measures wider than the regular face, so a block measured with the
 * regular face for both is narrower than the block it draws.
 */
const LABEL_TEXT_WEIGHT: FootprintTextWeight = 'regular';
const VALUE_TEXT_WEIGHT: FootprintTextWeight = 'bold';
/** The separator between the sell and buy totals of a one-column bar. */
const TOTALS_SEPARATOR = ' × ';

/** The space between the lowest row's cells and the side totals, in css px at the maximum text size. */
const TOTALS_GAP = 8;
/** The space between the side totals and the summary box below them, in css px at the maximum text size. */
const SUMMARY_GAP = 10;
/**
 * The height of one line of the box, how far its first line sits below its top edge and its corner radius, in css px at
 * the maximum text size: every one of them scales with the size the bar writes in. The box's lines are centred across
 * its width rather than inset from it, so this padding is the room they keep from its top and bottom edges.
 */
const SUMMARY_LINE_HEIGHT = 20;
const SUMMARY_PADDING = 6;
const SUMMARY_RADIUS = 6;
/** The room between the box's label column and the value written after it, in css px at the maximum text size. */
const LABEL_GAP = 6;
/** The thickness of the box's outline, in device pixels. */
const SUMMARY_BORDER_WIDTH = 1;
/**
 * The gap between the summary boxes of two bars side by side, in css px: the room a bar's summary may use stops that
 * much short of the slot's right end, so the boxes of neighbouring bars never touch.
 */
const SUMMARY_NEIGHBOUR_GAP = 4;
/**
 * The narrowest bar that writes its summary, in host CSS px: a narrower bar leaves its two columns too little
 * room for the totals and the box's two lines to read, so it writes nothing under them.
 */
export const MIN_SUMMARY_BAR_WIDTH = 60;

/** One piece of text the media pass writes: where, what, in which colour, at which size and how aligned there. */
export interface FootprintTextMark {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly color: string;
  readonly align: FootprintTextAlign;
  /** The size the whole bar writes in, in css px, which the mark's font is built from. */
  readonly size: number;
  /** Written bold, which the box's values are and its labels are not. */
  readonly bold?: boolean;
}

/** One run of a totals line: the text and the colour it is written in. */
interface FootprintTotalRun {
  readonly text: string;
  readonly color: string;
}

/** One line of the box as it is written: its label, and the value run after it. */
interface FootprintSummaryLine {
  readonly label: string;
  readonly value: FootprintTotalRun;
}

/** The rounded box under a bar's columns, in device pixels. */
export interface FootprintSummaryBox extends FootprintCellBox {
  /** The corner radius, in device pixels. */
  readonly radius: number;
}

/** The two lines the box writes: the bar's delta with its colour, and the volume it traded. */
export interface FootprintSummaryLines {
  readonly deltaText: string;
  readonly deltaColor: string;
  readonly totalText: string;
}

/** What one bar paints under its columns: its box, or none while the box is off, and the text around it. */
export interface FootprintSummaryLayout {
  readonly box: FootprintSummaryBox | null;
  readonly texts: readonly FootprintTextMark[];
}

/** What a bar's summary writes: whether the box is drawn, and the unit its numbers are counted in. */
export interface FootprintSummarySettings {
  readonly showSummary: boolean;
  readonly values: FootprintValues;
}

/** The delta as its line writes it: the amount with a leading minus sign while it points down. */
function deltaTextOf(delta: number): string {
  return footprintSignedText(delta);
}

/** The colour the delta is written in: green above zero, red below it, neutral on it. */
function deltaColorOf(delta: number): string {
  if (delta > 0) {
    return DELTA_RISING_COLOR;
  }
  if (delta < 0) {
    return DELTA_FALLING_COLOR;
  }
  return DELTA_FLAT_COLOR;
}

/** The delta of the sides, the buy one less the sell one, and what they traded in all. */
export function footprintSummaryLines({ buy, sell }: FootprintBarSides): FootprintSummaryLines {
  const delta = buy - sell;
  return {
    deltaText: deltaTextOf(delta),
    deltaColor: deltaColorOf(delta),
    totalText: footprintVolumeText(buy + sell),
  };
}

/** How tall one line of the box is at `style`'s size, in css px: SUMMARY_LINE_HEIGHT at the maximum text size. */
function summaryLineHeight(style: FootprintTextStyle): number {
  return SUMMARY_LINE_HEIGHT * footprintTextScale(style.size);
}

/** The room the box's lines keep from its top and bottom edges, in css px: SUMMARY_PADDING at the maximum size. */
function summaryPadding(style: FootprintTextStyle): number {
  return SUMMARY_PADDING * footprintTextScale(style.size);
}

/** The space between the lowest row's cells and the side totals at `style`'s size, in css px. */
function totalsGap(style: FootprintTextStyle): number {
  return TOTALS_GAP * footprintTextScale(style.size);
}

/** The media y of the middle of the box's line `index`. */
function lineCentre(box: FootprintSummaryBox, index: number, style: FootprintTextStyle): number {
  const lineHeight = summaryLineHeight(style);
  const top = box.top / style.verticalPixelRatio + summaryPadding(style) + index * lineHeight;
  return top + lineHeight / 2;
}

/** How wide the box is in css px: the room the block of its written lines is centred inside. */
function boxWidth(box: FootprintSummaryBox, style: FootprintTextStyle): number {
  return box.width / style.horizontalPixelRatio;
}

/** The layout a bar's columns make: a single-column bar leaves its sell slot empty. */
function layoutOfColumns(columns: FootprintBarColumns): FootprintLayout {
  return columns.sell.width === 0 ? 'single-column' : 'two-columns';
}

/**
 * The strip a bar's summary reports on, in device pixels: the one column of a single-column bar, whose left edge the
 * box and the totals start on, or the two columns of a two-column bar, from the sell column's left edge to the buy
 * column's right.
 */
function summarySpan(columns: FootprintBarColumns): FootprintColumn {
  if (layoutOfColumns(columns) === 'single-column') {
    return columns.buy;
  }
  return { left: columns.sell.left, width: columns.buy.left + columns.buy.width - columns.sell.left };
}

/**
 * The room one bar's summary has, in device pixels, from the strip's own left edge: the slot the bar stands in, less
 * SUMMARY_NEIGHBOUR_GAP css px, so the box of the bar beside it — which starts the same room right of its own strip —
 * never touches this one's. The room never falls under the strip itself, which the box always covers, however narrow
 * the slot the chart zooms the bar into.
 */
function summaryRoom(span: FootprintColumn, barSpacing: number, style: FootprintTextStyle): number {
  const slot = Math.round((barSpacing - SUMMARY_NEIGHBOUR_GAP) * style.horizontalPixelRatio);
  return Math.max(span.width, slot);
}

/**
 * The box under the side totals, in device pixels: it starts on the strip's left edge and is as wide as the wider of
 * the strip and `wantedWidth` — the block of the lines it holds with their padding — held inside the room the bar has.
 */
function summaryBox(
  span: FootprintColumn,
  room: number,
  wantedWidth: number,
  lowestRowBottomY: number,
  style: FootprintTextStyle,
): FootprintSummaryBox {
  const summaryGap = SUMMARY_GAP * footprintTextScale(style.size);
  const top = lowestRowBottomY + totalsGap(style) + footprintLineHeight(style.size) + summaryGap;
  const height = 2 * (summaryLineHeight(style) + summaryPadding(style));
  return {
    left: span.left,
    width: Math.min(room, Math.max(span.width, wantedWidth)),
    top: Math.round(top * style.verticalPixelRatio),
    height: Math.round(height * style.verticalPixelRatio),
    radius: Math.round(SUMMARY_RADIUS * footprintTextScale(style.size) * style.horizontalPixelRatio),
  };
}

/** The box a totals line is fitted against: the room it may use and one line of the bar's text size. */
function totalsLineBox(width: number, style: FootprintTextStyle): Pick<FootprintCellBox, 'width' | 'height'> {
  return { width, height: footprintLineHeight(style.size) * style.verticalPixelRatio };
}

/** One side's total under its own column, written against that column's edge nearest the thin candle. */
function totalMark(
  column: FootprintColumn,
  side: FootprintSide,
  text: string,
  color: string,
  totalsY: number,
  style: FootprintTextStyle,
): FootprintTextMark | null {
  if (!footprintTextFits(totalsLineBox(column.width, style), text, style)) {
    return null;
  }
  const align = footprintTextAlignOf(side);
  return { x: footprintTextX(column, align, style), y: totalsY, text, color, align, size: style.size };
}

/** The runs of a one-column bar's totals line: the sell total, the separator and the buy total. */
function singleColumnTotalRuns({ buy, sell }: FootprintBarSides): FootprintTotalRun[] {
  return [
    { text: footprintVolumeText(sell), color: SELL_TOTAL_COLOR },
    { text: TOTALS_SEPARATOR, color: TOTAL_TEXT_COLOR },
    { text: footprintVolumeText(buy), color: BUY_TOTAL_COLOR },
  ];
}

/**
 * Both totals in one line written from the single column's own inner edge, which it stands against. The line may run
 * on into the room the bar's slot leaves beside the column, so a pair of totals wider than the column is still
 * written while the room holds it.
 */
function singleColumnTotals(
  sides: FootprintBarSides,
  columns: FootprintBarColumns,
  totalsY: number,
  style: FootprintTextStyle,
  room: number,
): FootprintTextMark[] {
  const runs = singleColumnTotalRuns(sides);
  const line = runs.map((run) => run.text).join('');
  if (!footprintTextFits(totalsLineBox(room, style), line, style)) {
    return [];
  }
  const align = footprintTextAlignOf(SINGLE_COLUMN_SIDE);
  let x = footprintTextX(columns.buy, align, style);
  return runs.map((run) => {
    const mark = { x, y: totalsY, text: run.text, color: run.color, align, size: style.size };
    x += footprintTextWidthAt(run.text, style);
    return mark;
  });
}

/** Each side's total under its own column, or both in one line under the column of a one-column bar. */
function totalsTexts(
  sides: FootprintBarSides,
  columns: FootprintBarColumns,
  layout: FootprintLayout,
  totalsY: number,
  style: FootprintTextStyle,
  room: number,
): FootprintTextMark[] {
  if (layout === 'single-column') {
    return singleColumnTotals(sides, columns, totalsY, style, room);
  }
  const marks = [
    totalMark(columns.sell, 'sell', footprintVolumeText(sides.sell), SELL_TOTAL_COLOR, totalsY, style),
    totalMark(columns.buy, 'buy', footprintVolumeText(sides.buy), BUY_TOTAL_COLOR, totalsY, style),
  ];
  return marks.filter((mark): mark is FootprintTextMark => mark !== null);
}

/**
 * The width of the box's label column, in css px: its wider label in the regular face it is written in, plus the room
 * a value keeps before it.
 */
function labelColumnWidth(style: FootprintTextStyle): number {
  const label = Math.max(
    footprintTextWidthAt(DELTA_LABEL, style, LABEL_TEXT_WEIGHT),
    footprintTextWidthAt(TOTAL_LABEL, style, LABEL_TEXT_WEIGHT),
  );
  return label + LABEL_GAP * footprintTextScale(style.size);
}

/** The width one line needs, in css px: its regular label in the label column and the bold value after it. */
function lineWidth(line: FootprintSummaryLine, labelColumn: number, style: FootprintTextStyle): number {
  return labelColumn + footprintTextWidthAt(line.value.text, style, VALUE_TEXT_WEIGHT);
}

/**
 * How wide the box has to be to hold one of its lines at `style`'s size, in css px: the line's label and value block
 * with SUMMARY_PADDING on both sides of it, which the box never falls under.
 */
function lineRoom(line: FootprintSummaryLine, labelColumn: number, style: FootprintTextStyle): number {
  return lineWidth(line, labelColumn, style) + 2 * summaryPadding(style);
}

/** One line of the box that has room in it, and the slot of the box the line is written in. */
interface FootprintFittedLine {
  readonly line: FootprintSummaryLine;
  readonly index: number;
}

/**
 * The lines of the box that fit the room the bar has at `style`'s size, in the order the box writes them. The room is
 * the whole slot's, so the lines are decided against a width that does not move with the value written in them: a
 * value one character wider or narrower than the one before keeps the box's lines as they are, and only a value that
 * truly exceeds the room loses its line.
 */
function fittedLines(
  room: number,
  lines: readonly FootprintSummaryLine[],
  labelColumn: number,
  style: FootprintTextStyle,
): FootprintFittedLine[] {
  const roomInCss = room / style.horizontalPixelRatio;
  const fitted: FootprintFittedLine[] = [];
  lines.forEach((line, index) => {
    if (lineRoom(line, labelColumn, style) <= roomInCss) {
      fitted.push({ line, index });
    }
  });
  return fitted;
}

/** How wide the block of the box's written lines is at `style`'s size, in css px: its widest one. */
function blockWidth(fitted: readonly FootprintFittedLine[], labelColumn: number, style: FootprintTextStyle): number {
  return Math.max(...fitted.map(({ line }) => lineWidth(line, labelColumn, style)));
}

/**
 * The media x the block of the box's written lines starts at, in css px: half of the room the box's width leaves them,
 * so the two margins the block leaves read alike. `width` is the block measured exactly as the media pass draws it —
 * the labels in their regular face and the values in their bold one — so the left margin from the box's edge to the
 * labels and the right one from the widest value's end to the other edge are the same. Every written line has been
 * fitted to the room, and the box it is centred in always keeps the padding beside it, so the block never reaches past
 * the box's edges.
 */
function blockLeft(box: FootprintSummaryBox, width: number, style: FootprintTextStyle): number {
  return box.left / style.horizontalPixelRatio + (boxWidth(box, style) - width) / 2;
}

/** The two lines of the box, top to bottom: the bar's delta, then the volume it traded. */
function summaryLines(lines: FootprintSummaryLines): FootprintSummaryLine[] {
  return [
    { label: DELTA_LABEL, value: { text: lines.deltaText, color: lines.deltaColor } },
    { label: TOTAL_LABEL, value: { text: lines.totalText, color: TOTAL_TEXT_COLOR } },
  ];
}

/** One line of the box — its label, then its value in bold — written from the block's own left edge. */
function boxLine(
  box: FootprintSummaryBox,
  left: number,
  labelColumn: number,
  fitted: FootprintFittedLine,
  style: FootprintTextStyle,
): FootprintTextMark[] {
  const y = lineCentre(box, fitted.index, style);
  const color = fitted.line.value.color;
  const valueX = left + labelColumn;
  return [
    { x: left, y, text: fitted.line.label, color, align: 'left', size: style.size },
    { x: valueX, y, text: fitted.line.value.text, color, align: 'left', bold: true, size: style.size },
  ];
}

/**
 * The lines written in the box, centred in it as one block: a line the room has none for at this size is left out, and
 * the block the lines that fit make is centred on its own, so a box holding one line still centres it.
 */
function boxMarks(
  box: FootprintSummaryBox,
  fitted: readonly FootprintFittedLine[],
  labelColumn: number,
  style: FootprintTextStyle,
): FootprintTextMark[] {
  const left = blockLeft(box, blockWidth(fitted, labelColumn, style), style);
  return fitted.flatMap((fittedLine) => boxLine(box, left, labelColumn, fittedLine, style));
}

/**
 * What one bar writes under its columns: each side's total against its own column's inner edge — or, in the
 * single-column layout, both totals in one line under that column — and, while the summary is on, a rounded box
 * below them holding the bar's delta and the volume it traded. The box keeps its left edge on the strip's own and
 * grows right of it into the room the bar has, one `barSpacing` less SUMMARY_NEIGHBOUR_GAP: it is as wide as the wider
 * of the strip and the block of the lines it writes with SUMMARY_PADDING on both sides, and never wider than that
 * room, so the single-column box of a capped column grows to the text the column itself is too narrow for. The box's
 * lines make one block — a label in the box's fixed label column, then the value bold right after it — which is
 * measured in those very faces, the labels regular and the values bold, and centred across the box: the room from its
 * left edge to the labels equals the room from the widest value's end to its right edge, and both keep the full
 * padding. A line is left out only while it does not fit even the room, which does not move with the values a forming
 * bar changes, and a box no line of it fits is left off rather than drawn empty. The totals are fitted against the
 * layout's full columns, never a Profile cell's narrower share, so Profile keeps them, and the single-column totals
 * line runs on into the same room the box may use. Every text is written at `style`'s size. A bar whose summary strip
 * is narrower than MIN_SUMMARY_BAR_WIDTH writes neither.
 */
export function footprintSummaryLayout(
  footprint: BarFootprint,
  columns: FootprintBarColumns,
  barSpacing: number,
  lowestRowBottomY: number,
  settings: FootprintSummarySettings,
  style: FootprintTextStyle,
): FootprintSummaryLayout | null {
  const span = summarySpan(columns);
  if (span.width / style.horizontalPixelRatio < MIN_SUMMARY_BAR_WIDTH) {
    return null;
  }
  const room = summaryRoom(span, barSpacing, style);
  const sides = footprintBarSides(footprint, settings.values);
  const totalsY = lowestRowBottomY + totalsGap(style) + footprintLineHeight(style.size) / 2;
  const totals = totalsTexts(sides, columns, layoutOfColumns(columns), totalsY, style, room);
  if (!settings.showSummary) {
    return { box: null, texts: totals };
  }
  const labelColumn = labelColumnWidth(style);
  const fitted = fittedLines(room, summaryLines(footprintSummaryLines(sides)), labelColumn, style);
  if (fitted.length === 0) {
    // No line of the box has room at this size, so the box is left off rather than drawn empty.
    return { box: null, texts: totals };
  }
  const block = blockWidth(fitted, labelColumn, style);
  const padding = 2 * summaryPadding(style);
  const wantedWidth = Math.round((block + padding) * style.horizontalPixelRatio);
  const box = summaryBox(span, room, wantedWidth, lowestRowBottomY, style);
  return { box, texts: [...totals, ...boxMarks(box, fitted, labelColumn, style)] };
}

/** `box` with its outline taken off every side, which the fill is drawn inside. */
function insetSummaryBox(box: FootprintSummaryBox): FootprintSummaryBox {
  return {
    left: box.left + SUMMARY_BORDER_WIDTH,
    top: box.top + SUMMARY_BORDER_WIDTH,
    width: Math.max(0, box.width - 2 * SUMMARY_BORDER_WIDTH),
    height: Math.max(0, box.height - 2 * SUMMARY_BORDER_WIDTH),
    radius: Math.max(0, box.radius - SUMMARY_BORDER_WIDTH),
  };
}

/** Paths `box`'s rounded corners, ready to fill. */
function summaryBoxPath(context: CanvasRenderingContext2D, box: FootprintSummaryBox): void {
  const radius = Math.min(box.radius, box.width / 2, box.height / 2);
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  context.beginPath();
  context.moveTo(box.left + radius, box.top);
  context.lineTo(right - radius, box.top);
  context.arcTo(right, box.top, right, box.top + radius, radius);
  context.lineTo(right, bottom - radius);
  context.arcTo(right, bottom, right - radius, bottom, radius);
  context.lineTo(box.left + radius, bottom);
  context.arcTo(box.left, bottom, box.left, bottom - radius, radius);
  context.lineTo(box.left, box.top + radius);
  context.arcTo(box.left, box.top, box.left + radius, box.top, radius);
  context.closePath();
}

/** Paints the box's outline and the fill inside it, both in device pixels. */
export function paintFootprintSummaryBox(context: CanvasRenderingContext2D, box: FootprintSummaryBox): void {
  context.save();
  context.fillStyle = SUMMARY_BOX_BORDER;
  summaryBoxPath(context, box);
  context.fill();
  context.fillStyle = SUMMARY_BOX_FILL;
  summaryBoxPath(context, insetSummaryBox(box));
  context.fill();
  context.restore();
}
