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
/** The separator between the sell and buy totals of a one-column bar. */
const TOTALS_SEPARATOR = ' × ';

/** The space between the lowest row's cells and the side totals, in css px at the maximum text size. */
const TOTALS_GAP = 4;
/** The space between the side totals and the summary box below them, in css px at the maximum text size. */
const SUMMARY_GAP = 6;
/**
 * The height of one line of the box, how far its text sits inside it and its corner radius, in css px at the maximum
 * text size: every one of them scales with the size the bar writes in.
 */
const SUMMARY_LINE_HEIGHT = 20;
const SUMMARY_PADDING = 6;
const SUMMARY_RADIUS = 6;
/** The room between the box's label column and the value written after it, in css px at the maximum text size. */
const LABEL_GAP = 6;
/** The thickness of the box's outline, in device pixels. */
const SUMMARY_BORDER_WIDTH = 1;
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

/** The block the box's two lines make, in css px: where it starts and how wide its label column is. */
interface FootprintSummaryBlock {
  readonly left: number;
  readonly labelColumn: number;
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

/** How far the box's lines sit inside it at `style`'s size, in css px: SUMMARY_PADDING at the maximum text size. */
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

/** The media x the box's own padding starts at, which the block of its two lines never starts left of. */
function boxInnerLeft(box: FootprintSummaryBox, style: FootprintTextStyle): number {
  return box.left / style.horizontalPixelRatio + summaryPadding(style);
}

/** How much of the box's width its two lines have to write in, in css px. */
function boxInnerWidth(box: FootprintSummaryBox, style: FootprintTextStyle): number {
  return box.width / style.horizontalPixelRatio - 2 * summaryPadding(style);
}

/** The layout a bar's columns make: a single-column bar leaves its sell slot empty. */
function layoutOfColumns(columns: FootprintBarColumns): FootprintLayout {
  return columns.sell.width === 0 ? 'single-column' : 'two-columns';
}

/**
 * The strip a bar's summary reports on, in device pixels: the one column of a single-column bar, which the box and
 * the totals span exactly, or the two columns of a two-column bar, from the sell column's left edge to the buy
 * column's right.
 */
function summarySpan(columns: FootprintBarColumns): FootprintColumn {
  if (layoutOfColumns(columns) === 'single-column') {
    return columns.buy;
  }
  return { left: columns.sell.left, width: columns.buy.left + columns.buy.width - columns.sell.left };
}

/** The box under the side totals, spanning the strip the bar's summary reports on, in device pixels. */
function summaryBox(
  columns: FootprintBarColumns,
  lowestRowBottomY: number,
  style: FootprintTextStyle,
): FootprintSummaryBox {
  const span = summarySpan(columns);
  const summaryGap = SUMMARY_GAP * footprintTextScale(style.size);
  const top = lowestRowBottomY + totalsGap(style) + footprintLineHeight(style.size) + summaryGap;
  const height = 2 * (summaryLineHeight(style) + summaryPadding(style));
  return {
    left: span.left,
    width: span.width,
    top: Math.round(top * style.verticalPixelRatio),
    height: Math.round(height * style.verticalPixelRatio),
    radius: Math.round(SUMMARY_RADIUS * footprintTextScale(style.size) * style.horizontalPixelRatio),
  };
}

/** The box a totals line is fitted against: its column's width and one line of the bar's text size. */
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

/** Both totals in one line written from the single column's own inner edge, which it stands against. */
function singleColumnTotals(
  sides: FootprintBarSides,
  columns: FootprintBarColumns,
  totalsY: number,
  style: FootprintTextStyle,
): FootprintTextMark[] {
  const runs = singleColumnTotalRuns(sides);
  const line = runs.map((run) => run.text).join('');
  if (!footprintTextFits(totalsLineBox(columns.buy.width, style), line, style)) {
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
): FootprintTextMark[] {
  if (layout === 'single-column') {
    return singleColumnTotals(sides, columns, totalsY, style);
  }
  const marks = [
    totalMark(columns.sell, 'sell', footprintVolumeText(sides.sell), SELL_TOTAL_COLOR, totalsY, style),
    totalMark(columns.buy, 'buy', footprintVolumeText(sides.buy), BUY_TOTAL_COLOR, totalsY, style),
  ];
  return marks.filter((mark): mark is FootprintTextMark => mark !== null);
}

/** The width of the box's label column, in css px: its wider label plus the room before a value. */
function labelColumnWidth(style: FootprintTextStyle): number {
  const label = Math.max(footprintTextWidthAt(DELTA_LABEL, style), footprintTextWidthAt(TOTAL_LABEL, style));
  return label + LABEL_GAP * footprintTextScale(style.size);
}

/** The width of the block the two lines make, in css px: its label column and the wider of the two values after it. */
function summaryBlockWidth(labelColumn: number, lines: FootprintSummaryLines, style: FootprintTextStyle): number {
  const value = Math.max(footprintTextWidthAt(lines.deltaText, style), footprintTextWidthAt(lines.totalText, style));
  return labelColumn + value;
}

/**
 * The media x the block of the box's two lines starts at, in css px: the box's left edge plus half the room its width
 * leaves, so both margins read alike — but never left of the inner edge its padding leaves, which a block too wide to
 * centre stands on instead.
 */
function blockLeft(box: FootprintSummaryBox, width: number, style: FootprintTextStyle): number {
  const boxWidth = box.width / style.horizontalPixelRatio;
  const centred = box.left / style.horizontalPixelRatio + (boxWidth - width) / 2;
  return Math.max(boxInnerLeft(box, style), centred);
}

/** The block the box's two lines make: where it starts, and the label column both lines write their labels in. */
function summaryBlock(
  box: FootprintSummaryBox,
  lines: FootprintSummaryLines,
  style: FootprintTextStyle,
): FootprintSummaryBlock {
  const labelColumn = labelColumnWidth(style);
  const width = summaryBlockWidth(labelColumn, lines, style);
  return { left: blockLeft(box, width, style), labelColumn };
}

/** The two lines of the box, top to bottom: the bar's delta, then the volume it traded. */
function summaryLines(lines: FootprintSummaryLines): FootprintSummaryLine[] {
  return [
    { label: DELTA_LABEL, value: { text: lines.deltaText, color: lines.deltaColor } },
    { label: TOTAL_LABEL, value: { text: lines.totalText, color: TOTAL_TEXT_COLOR } },
  ];
}

/** One line of the box — its label, then its value in bold — or none while the line does not fit the box. */
function boxLine(
  box: FootprintSummaryBox,
  block: FootprintSummaryBlock,
  index: number,
  line: FootprintSummaryLine,
  style: FootprintTextStyle,
): FootprintTextMark[] {
  const { labelColumn } = block;
  if (labelColumn + footprintTextWidthAt(line.value.text, style) > boxInnerWidth(box, style)) {
    return [];
  }
  const y = lineCentre(box, index, style);
  const valueX = block.left + labelColumn;
  return [
    { x: block.left, y, text: line.label, color: line.value.color, align: 'left', size: style.size },
    { x: valueX, y, text: line.value.text, color: line.value.color, align: 'left', bold: true, size: style.size },
  ];
}

/** The two lines of the box, both centred in it as one block and each written only while it has room inside. */
function boxLines(
  box: FootprintSummaryBox,
  lines: FootprintSummaryLines,
  style: FootprintTextStyle,
): FootprintTextMark[] {
  const block = summaryBlock(box, lines, style);
  const marks: FootprintTextMark[] = [];
  summaryLines(lines).forEach((line, index) => {
    marks.push(...boxLine(box, block, index, line, style));
  });
  return marks;
}

/**
 * What one bar writes under its columns: each side's total against its own column's inner edge — or, in the
 * single-column layout, both totals in one line under that column — and, while the summary is on, a rounded box
 * below them holding the bar's delta and the volume it traded. The box's two lines make one block — a label in the
 * box's fixed label column, then the value bold right after it — which is centred in the box, never starting left of
 * its padding. The totals are fitted against the layout's full columns, never a Profile cell's narrower share, so
 * Profile keeps them. Every text is written at `style`'s size and only while it fits the column or the box it belongs
 * to; a box no line of it fits is left off rather than drawn empty, and a bar whose summary strip is narrower than
 * MIN_SUMMARY_BAR_WIDTH writes neither.
 */
export function footprintSummaryLayout(
  footprint: BarFootprint,
  columns: FootprintBarColumns,
  lowestRowBottomY: number,
  settings: FootprintSummarySettings,
  style: FootprintTextStyle,
): FootprintSummaryLayout | null {
  const box = summaryBox(columns, lowestRowBottomY, style);
  if (box.width / style.horizontalPixelRatio < MIN_SUMMARY_BAR_WIDTH) {
    return null;
  }
  const sides = footprintBarSides(footprint, settings.values);
  const totalsY = lowestRowBottomY + totalsGap(style) + footprintLineHeight(style.size) / 2;
  const totals = totalsTexts(sides, columns, layoutOfColumns(columns), totalsY, style);
  if (!settings.showSummary) {
    return { box: null, texts: totals };
  }
  const lines = boxLines(box, footprintSummaryLines(sides), style);
  if (lines.length === 0) {
    // No line of the box has room at this size, so the box is left off rather than drawn empty.
    return { box: null, texts: totals };
  }
  return { box, texts: [...totals, ...lines] };
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
