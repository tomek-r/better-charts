import { palette } from '../../../../../shared/theme/palette';
import type { DevicePixelRatios } from '../barBodyWidth';
import type { BarFootprint } from './footprintData';
import {
  footprintTextFits,
  type FootprintBarColumns,
  type FootprintCellBox,
  type FootprintColumn,
  type FootprintTextWidth,
} from './footprintGeometry';
import type { FootprintLayout, FootprintValues } from './footprintModes';
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
/** The labels the two lines start with. */
const DELTA_LABEL = 'Delta ';
const TOTAL_LABEL = 'Total ';
/** The separator between the sell and buy totals of a one-column bar. */
const TOTALS_SEPARATOR = ' × ';

/** The space between the lowest row's cells and the side totals, in host CSS px. */
const TOTALS_GAP = 2;
/** The height of the line the side totals are written in, in host CSS px. */
const TOTALS_LINE_HEIGHT = 10;
/** The space between the side totals and the summary box below them, in host CSS px. */
const SUMMARY_GAP = 2;
/** The height of one line of the box, how far its text sits inside it and its corner radius, in host CSS px. */
const SUMMARY_LINE_HEIGHT = 10;
const SUMMARY_PADDING = 3;
const SUMMARY_RADIUS = 3;
/** The thickness of the box's outline, in device pixels. */
const SUMMARY_BORDER_WIDTH = 1;
/**
 * The narrowest bar that writes its summary, in host CSS px: a narrower bar leaves its two columns too little
 * room for the totals and the box's two lines to read, so it writes nothing under them.
 */
export const MIN_SUMMARY_BAR_WIDTH = 60;

/** One piece of text the media pass writes: where, what and in which colour. */
export interface FootprintTextMark {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly color: string;
}

/** One run of a totals line: the text and the colour it is written in. */
interface FootprintTotalRun {
  readonly text: string;
  readonly color: string;
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

/** The media x of the middle of `column`. */
function columnCentre(column: FootprintColumn, horizontalPixelRatio: number): number {
  return (column.left + column.width / 2) / horizontalPixelRatio;
}

/** The media x of the middle of `box`. */
function boxCentre(box: FootprintCellBox, horizontalPixelRatio: number): number {
  return (box.left + box.width / 2) / horizontalPixelRatio;
}

/** The media y of the middle of the box's line `index`. */
function lineCentre(box: FootprintSummaryBox, index: number, verticalPixelRatio: number): number {
  const top = box.top / verticalPixelRatio + SUMMARY_PADDING + index * SUMMARY_LINE_HEIGHT;
  return top + SUMMARY_LINE_HEIGHT / 2;
}

/** How many device pixels a bar's columns span: from the sell column's left edge to the buy column's right. */
function columnsWidth(columns: FootprintBarColumns): number {
  return columns.buy.left + columns.buy.width - columns.sell.left;
}

/** The bar's columns as one span, from the sell slot's left edge to the buy column's right edge. */
function columnsSpan(columns: FootprintBarColumns): FootprintColumn {
  return { left: columns.sell.left, width: columnsWidth(columns) };
}

/** The layout a bar's columns make: a single-column bar leaves its sell slot empty. */
function layoutOfColumns(columns: FootprintBarColumns): FootprintLayout {
  return columns.sell.width === 0 ? 'single-column' : 'two-columns';
}

/** The box under the side totals, spanning the bar's columns out to its buy edge, in device pixels. */
function summaryBox(
  columns: FootprintBarColumns,
  lowestRowBottomY: number,
  ratios: DevicePixelRatios,
): FootprintSummaryBox {
  const top = lowestRowBottomY + TOTALS_GAP + TOTALS_LINE_HEIGHT + SUMMARY_GAP;
  const height = 2 * SUMMARY_LINE_HEIGHT + 2 * SUMMARY_PADDING;
  return {
    left: columns.sell.left,
    width: columnsWidth(columns),
    top: Math.round(top * ratios.verticalPixelRatio),
    height: Math.round(height * ratios.verticalPixelRatio),
    radius: Math.round(SUMMARY_RADIUS * ratios.horizontalPixelRatio),
  };
}

/** The marks of `runs` laid side by side, centred on the media x `centreX`, or none while the line does not fit. */
function totalsLineMarks(
  runs: readonly FootprintTotalRun[],
  width: number,
  centreX: number,
  totalsY: number,
  ratios: DevicePixelRatios,
  textWidth: FootprintTextWidth,
): FootprintTextMark[] {
  const height = TOTALS_LINE_HEIGHT * ratios.verticalPixelRatio;
  const line = runs.map((run) => run.text).join('');
  if (!footprintTextFits(width, height, line, ratios, textWidth)) {
    return [];
  }
  const widths = runs.map((run) => textWidth(run.text));
  let left = centreX - widths.reduce((sum, runWidth) => sum + runWidth, 0) / 2;
  return runs.map((run, index) => {
    const runWidth = widths[index] ?? 0;
    const mark = { x: left + runWidth / 2, y: totalsY, text: run.text, color: run.color };
    left += runWidth;
    return mark;
  });
}

/**
 * Each side's total under its own column, at the media y `totalsY`, or none while its column has no room for it.
 * The fit is measured against the column's full width, which a Profile cell's share never narrows.
 */
function totalMark(
  column: FootprintColumn,
  text: string,
  color: string,
  totalsY: number,
  ratios: DevicePixelRatios,
  textWidth: FootprintTextWidth,
): FootprintTextMark | null {
  const marks = totalsLineMarks(
    [{ text, color }],
    column.width,
    columnCentre(column, ratios.horizontalPixelRatio),
    totalsY,
    ratios,
    textWidth,
  );
  return marks[0] ?? null;
}

/** The runs of a one-column bar's totals line: the sell total, the separator and the buy total. */
function singleColumnTotalRuns({ buy, sell }: FootprintBarSides): FootprintTotalRun[] {
  return [
    { text: footprintVolumeText(sell), color: SELL_TOTAL_COLOR },
    { text: TOTALS_SEPARATOR, color: TOTAL_TEXT_COLOR },
    { text: footprintVolumeText(buy), color: BUY_TOTAL_COLOR },
  ];
}

/** Each side's total under its own column, or both in one line centred under a one-column bar. */
function totalsTexts(
  sides: FootprintBarSides,
  columns: FootprintBarColumns,
  layout: FootprintLayout,
  totalsY: number,
  ratios: DevicePixelRatios,
  textWidth: FootprintTextWidth,
): FootprintTextMark[] {
  if (layout === 'single-column') {
    return totalsLineMarks(
      singleColumnTotalRuns(sides),
      columnsWidth(columns),
      columnCentre(columnsSpan(columns), ratios.horizontalPixelRatio),
      totalsY,
      ratios,
      textWidth,
    );
  }
  const marks = [
    totalMark(columns.sell, footprintVolumeText(sides.sell), SELL_TOTAL_COLOR, totalsY, ratios, textWidth),
    totalMark(columns.buy, footprintVolumeText(sides.buy), BUY_TOTAL_COLOR, totalsY, ratios, textWidth),
  ];
  return marks.filter((mark): mark is FootprintTextMark => mark !== null);
}

/** One line of the box, or none while the box has no room for the text inside its padding. */
function boxLine(
  box: FootprintSummaryBox,
  index: number,
  text: string,
  color: string,
  ratios: DevicePixelRatios,
  textWidth: FootprintTextWidth,
): FootprintTextMark | null {
  const width = box.width - 2 * SUMMARY_PADDING * ratios.horizontalPixelRatio;
  const height = SUMMARY_LINE_HEIGHT * ratios.verticalPixelRatio;
  if (!footprintTextFits(width, height, text, ratios, textWidth)) {
    return null;
  }
  return {
    x: boxCentre(box, ratios.horizontalPixelRatio),
    y: lineCentre(box, index, ratios.verticalPixelRatio),
    text,
    color,
  };
}

/** The two lines of the box, each written only while the box has room for the text inside its padding. */
function boxLines(
  box: FootprintSummaryBox,
  lines: FootprintSummaryLines,
  ratios: DevicePixelRatios,
  textWidth: FootprintTextWidth,
): FootprintTextMark[] {
  const marks = [
    boxLine(box, 0, `${DELTA_LABEL}${lines.deltaText}`, lines.deltaColor, ratios, textWidth),
    boxLine(box, 1, `${TOTAL_LABEL}${lines.totalText}`, TOTAL_TEXT_COLOR, ratios, textWidth),
  ];
  return marks.filter((mark): mark is FootprintTextMark => mark !== null);
}

/**
 * What one bar writes under its columns: each side's total under its own column — or, in the single-column layout,
 * both totals in one line centred under the bar's whole span — and, while the summary is on, a rounded box below
 * them holding the bar's delta and the volume it traded. The totals are fitted against the layout's full columns,
 * never a Profile cell's narrower share, so Profile keeps them. A bar narrower than MIN_SUMMARY_BAR_WIDTH writes
 * neither, so a cramped bar is left to its cells, and every text is written only while `textWidth` says it fits the
 * column or the box it belongs to.
 */
export function footprintSummaryLayout(
  footprint: BarFootprint,
  columns: FootprintBarColumns,
  lowestRowBottomY: number,
  settings: FootprintSummarySettings,
  ratios: DevicePixelRatios,
  textWidth: FootprintTextWidth,
): FootprintSummaryLayout | null {
  const width = columnsWidth(columns);
  if (width / ratios.horizontalPixelRatio < MIN_SUMMARY_BAR_WIDTH) {
    return null;
  }
  const sides = footprintBarSides(footprint, settings.values);
  const totalsY = lowestRowBottomY + TOTALS_GAP + TOTALS_LINE_HEIGHT / 2;
  const totals = totalsTexts(sides, columns, layoutOfColumns(columns), totalsY, ratios, textWidth);
  if (!settings.showSummary) {
    return { box: null, texts: totals };
  }
  const box = summaryBox(columns, lowestRowBottomY, ratios);
  const lines = boxLines(box, footprintSummaryLines(sides), ratios, textWidth);
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
