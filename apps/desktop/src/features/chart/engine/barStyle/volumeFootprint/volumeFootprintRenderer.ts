import type { CustomBarItemData, PaneRendererCustomData, PriceToCoordinateConverter, Time } from 'lightweight-charts';
import { withOpacityPercent } from '../../../../../shared/theme/hexColor';
import { barBodyWidth, type DevicePixelRatios } from '../barBodyWidth';
import { candlePrices, paintCandle, type CandleGlyphStyle, type CandlePrices } from '../candleGlyph';
import { CustomBarRenderer, type SeriesRenderingTarget, type VisibleBarIndices } from '../customBarRenderer';
import { plottedVisibleBars } from '../customBarVisibleRange';
import { volumeCandleColors } from '../volumeCandles/volumeCandleColors';
import { footprintCells, type FootprintCell } from './footprintCells';
import type { BarFootprint, ChartFootprintRow } from './footprintData';
import {
  FOOTPRINT_FONT_SIZE,
  footprintBarColumns,
  footprintCellShowsText,
  footprintProfileBox,
  footprintRowBox,
  footprintRowGapBox,
  footprintTextAlignOf,
  footprintTextX,
  type FootprintBarColumns,
  type FootprintCellBox,
  type FootprintTextWidth,
} from './footprintGeometry';
import { footprintImbalanceBox, imbalanceMarkColor } from './footprintImbalance';
import { footprintLayoutOf } from './footprintModes';
import type { FootprintSide } from './footprintShades';
import { footprintStackedZones, type FootprintStackedZone } from './footprintStackedZones';
import { footprintSummaryLayout, paintFootprintSummaryBox, type FootprintTextMark } from './footprintSummary';
import {
  paintValueAreaLines,
  paintValueAreaMarkers,
  valueAreaMarkerX,
  type FootprintValueAreaMark,
  type FootprintValueAreaSpan,
} from './footprintValueArea';
import { VOLUME_FOOTPRINT_DEFAULT_OPTIONS, type VolumeFootprintOptions } from './volumeFootprintOptions';
import type { VolumeFootprintPoint } from './volumeFootprintPoint';

/** The family the cells' numbers and the value area marker are written in. */
const FOOTPRINT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
/** The font the cells' numbers are written in, which the text fit is measured in. */
const FOOTPRINT_FONT = `${FOOTPRINT_FONT_SIZE}px ${FOOTPRINT_FONT_FAMILY}`;
/** The font a summary line's value is written in, right after its label. */
const FOOTPRINT_BOLD_FONT = `bold ${FOOTPRINT_FONT}`;
/** The share of its side's colour a stacked zone's band is filled at, so what it covers stays readable through it. */
const STACKED_ZONE_FILL_PERCENT = 20;
/** The thickness of a stacked zone's top and bottom edge lines, in device pixels. */
const STACKED_ZONE_EDGE_WIDTH = 1;

/** What every bar of one paint shares: the canvas, the options, the price scale and the bar's body width. */
interface FootprintPaint extends DevicePixelRatios {
  readonly context: CanvasRenderingContext2D;
  readonly options: VolumeFootprintOptions;
  readonly priceConverter: PriceToCoordinateConverter;
  readonly fullWidth: number;
  /** How wide a text is drawn, in css px, which decides whether a cell or a total has room for it. */
  readonly textWidth: FootprintTextWidth;
}

/** One visible bar as it is painted: its media x, its point and the media y of its prices. */
interface FootprintBar {
  readonly x: number;
  readonly point: VolumeFootprintPoint;
  readonly prices: CandlePrices;
}

/** What the bitmap pass hands the media pass: the text it found room for and the value areas it marked. */
interface FootprintMarks {
  readonly texts: FootprintTextMark[];
  readonly valueAreas: FootprintValueAreaMark[];
}

/**
 * The two boxes one cell covers: the one it is filled in and writes its number in, which stops a row gap above the
 * row below, and the whole row, which its imbalance marks span.
 */
interface FootprintCellBoxes {
  readonly cell: FootprintCellBox;
  readonly row: FootprintCellBox;
}

/** One stacked zone placed on the pane: the media x it starts at and the one it ends at, null for the pane's edge. */
interface PlacedStackedZone extends FootprintStackedZone {
  readonly startX: number;
  readonly endX: number | null;
}

/** The bar the zones are placed from: a visible bar's own media x, and its place among the series' bars. */
interface ZoneAnchor {
  readonly index: number;
  readonly x: number;
}

/** What one paint draws: the visible bars, the zones under them and the price scale that places their prices. */
interface FootprintPaintSource {
  readonly priceConverter: PriceToCoordinateConverter;
  readonly barSpacing: number;
  readonly zones: readonly PlacedStackedZone[];
  readonly bars: readonly FootprintBar[];
}

/** The visible bars the price scale can place, in the order they are drawn. */
function plottedFootprintBars(
  bars: readonly CustomBarItemData<Time, VolumeFootprintPoint>[],
  visibleBars: VisibleBarIndices,
  priceConverter: PriceToCoordinateConverter,
): FootprintBar[] {
  return plottedVisibleBars(bars, visibleBars, (point, x) => {
    const prices = candlePrices(point, priceConverter);
    return prices === null ? null : { x, point, prices };
  });
}

/** The bar the zones are placed from: the first visible one, whose own media x the chart laid out for this paint. */
function zoneAnchor(
  bars: readonly CustomBarItemData<Time, VolumeFootprintPoint>[],
  visibleBars: VisibleBarIndices,
): ZoneAnchor | null {
  // The visible window starts before the first bar while the pane holds space left of it.
  const index = Math.max(0, visibleBars.from);
  const first = bars[index];
  return first === undefined ? null : { index, x: first.x };
}

/** The media x of the bar at `index`: a bar spacing further right of the anchor for every bar after it. */
function zoneBarX(anchor: ZoneAnchor, index: number, barSpacing: number): number {
  return anchor.x + (index - anchor.index) * barSpacing;
}

/**
 * The zones the options ask for, placed at the media x of the bars they start and end on. Every bar of the series
 * feeds them, not only the visible ones, so a zone of a bar left of the pane still draws while it reaches into it.
 */
function placedStackedZones(
  data: PaneRendererCustomData<Time, VolumeFootprintPoint>,
  visibleBars: VisibleBarIndices,
  options: VolumeFootprintOptions,
): PlacedStackedZone[] {
  if (!options.stackedImbalance.visible) {
    return [];
  }
  const zones = footprintStackedZones(
    data.bars.map((bar) => bar.originalData),
    options.stackedImbalance.count,
  );
  const anchor = zoneAnchor(data.bars, visibleBars);
  if (zones.length === 0 || anchor === null) {
    return [];
  }
  return zones.map((zone) => ({
    ...zone,
    startX: zoneBarX(anchor, zone.startIndex, data.barSpacing),
    endX: zone.endIndex === null ? null : zoneBarX(anchor, zone.endIndex, data.barSpacing),
  }));
}

/** Paints the imbalance mark standing on the edge of `side` of one cell, in its side's own colour. */
function paintImbalanceMark(paint: FootprintPaint, box: FootprintCellBox, side: FootprintSide): void {
  const highlight = paint.options.imbalanceHighlight;
  if (!highlight.visible) {
    return;
  }
  const mark = footprintImbalanceBox(box, side, paint.horizontalPixelRatio);
  paint.context.fillStyle = imbalanceMarkColor(highlight, side);
  paint.context.fillRect(mark.left, mark.top, mark.width, mark.height);
}

/**
 * Paints one cell: its fill, the number it writes against its column's inner edge and the marks on its edges. The
 * marks span the cell's whole row, so they stay on the row's prices rather than stopping at its box's lower edge.
 */
function paintCell(paint: FootprintPaint, cell: FootprintCell, boxes: FootprintCellBoxes, marks: FootprintMarks): void {
  const box = boxes.cell;
  paint.context.fillStyle = cell.fill;
  paint.context.fillRect(box.left, box.top, box.width, box.height);
  if (footprintCellShowsText(box, cell.text, paint, paint.textWidth)) {
    const align = footprintTextAlignOf(cell.column);
    marks.texts.push({
      x: footprintTextX(box, align, paint.horizontalPixelRatio),
      y: (box.top + box.height / 2) / paint.verticalPixelRatio,
      text: cell.text,
      color: cell.textColor,
      align,
    });
  }
  for (const side of cell.marks) {
    paintImbalanceMark(paint, boxes.row, side);
  }
}

/** Paints one bar's cells: every row's cells where their prices put them, with the marks they carry. */
function paintFootprintCells(
  paint: FootprintPaint,
  footprint: BarFootprint,
  columns: FootprintBarColumns,
  marks: FootprintMarks,
): void {
  for (const { row, cells } of footprintCells(footprint, paint.options)) {
    const topY = paint.priceConverter(row.upPrice);
    const bottomY = paint.priceConverter(row.downPrice);
    if (topY === null || bottomY === null) {
      continue;
    }
    for (const cell of cells) {
      paintCell(paint, cell, cellBoxes(paint, cell, columns, topY, bottomY), marks);
    }
  }
}

/**
 * The boxes one cell covers: its column between the row's two prices, narrowed to the share a profile cell takes —
 * the whole row, and the cell's own box, which leaves the row gap under it.
 */
function cellBoxes(
  paint: FootprintPaint,
  cell: FootprintCell,
  columns: FootprintBarColumns,
  topY: number,
  bottomY: number,
): FootprintCellBoxes {
  const row = footprintProfileBox(
    footprintRowBox(columns[cell.column], topY, bottomY, paint.verticalPixelRatio),
    cell.widthShare,
    cell.column,
  );
  return { cell: footprintRowGapBox(row, paint.verticalPixelRatio), row };
}

/** The media y of one value area line: the top of the VAH row, or the bottom of the VAL row. */
function valueAreaLineY(paint: FootprintPaint, row: ChartFootprintRow | undefined, top: boolean): number | null {
  if (row === undefined) {
    return null;
  }
  return paint.priceConverter(top ? row.upPrice : row.downPrice);
}

/** The device-pixel span a value area line crosses: the whole bar, from its sell column out to its buy edge. */
function valueAreaSpan(columns: FootprintBarColumns): FootprintValueAreaSpan {
  return { left: columns.sell.left, right: columns.buy.left + columns.buy.width };
}

/** Paints the value area's dashed lines across the bar, and notes where the media pass marks their left ends. */
function paintValueArea(
  paint: FootprintPaint,
  footprint: BarFootprint,
  columns: FootprintBarColumns,
  marks: FootprintMarks,
): void {
  if (!paint.options.showValueArea) {
    return;
  }
  const vahRow = footprint.rows.find((row) => row.row === footprint.vah);
  const valRow = footprint.rows.find((row) => row.row === footprint.val);
  const lineYs = [valueAreaLineY(paint, vahRow, true), valueAreaLineY(paint, valRow, false)];
  const ys = lineYs.filter((y): y is number => y !== null);
  if (ys.length === 0) {
    return;
  }
  const span = valueAreaSpan(columns);
  paintValueAreaLines(paint.context, span, ys, paint);
  marks.valueAreas.push({ markerX: valueAreaMarkerX(span, paint.horizontalPixelRatio), ys });
}

/**
 * Writes what one bar says under its columns: each side's total, or both in one line in the single-column layout,
 * and the delta box below them while the summary is on. The lowest row's bottom is where both start, so neither
 * covers a cell, and the totals use the full columns rather than any profile cell's share.
 */
function paintSummary(
  paint: FootprintPaint,
  footprint: BarFootprint,
  columns: FootprintBarColumns,
  marks: FootprintMarks,
): void {
  const lowest = footprint.rows[0];
  const lowestBottomY = lowest === undefined ? null : paint.priceConverter(lowest.downPrice);
  if (lowestBottomY === null) {
    return;
  }
  const summary = footprintSummaryLayout(footprint, columns, lowestBottomY, paint.options, paint, paint.textWidth);
  if (summary === null) {
    return;
  }
  if (summary.box !== null) {
    paintFootprintSummaryBox(paint.context, summary.box);
  }
  marks.texts.push(...summary.texts);
}

/**
 * The columns of the bar at the media x `x`: the layout the appearance's type asks for, at the body's full width, so
 * every caller reads the same columns — the capped ones, centred on the bar's own x.
 */
function barColumns(paint: FootprintPaint, x: number): FootprintBarColumns {
  return footprintBarColumns(x, paint.fullWidth, paint.horizontalPixelRatio, footprintLayoutOf(paint.options.type));
}

/** The media x the thin candle is drawn on: the middle of its own column, which the layout has placed for it. */
function candleCentreX(paint: FootprintPaint, columns: FootprintBarColumns): number {
  return (columns.candle.left + columns.candle.width / 2) / paint.horizontalPixelRatio;
}

/**
 * The device x of the right edge of the columns a bar at the media x `x` draws: the buy column's right edge, which a
 * group narrower than its body, its columns capped, stops at rather than reaching the body's own right edge.
 */
function groupRightEdge(paint: FootprintPaint, x: number): number {
  const columns = barColumns(paint, x);
  return columns.buy.left + columns.buy.width;
}

/** The device box one zone's band covers: its price range, from the right edge of its bar's columns to its end bar. */
function stackedZoneBox(paint: FootprintPaint, zone: PlacedStackedZone, paneWidth: number): FootprintCellBox | null {
  const topY = paint.priceConverter(zone.upPrice);
  const bottomY = paint.priceConverter(zone.downPrice);
  if (topY === null || bottomY === null) {
    return null;
  }
  const left = groupRightEdge(paint, zone.startX);
  const right = zone.endX === null ? paneWidth : Math.round(zone.endX * paint.horizontalPixelRatio);
  // A zone that ends before it starts, or left of the pane, paints nothing at all.
  if (right <= left || right <= 0) {
    return null;
  }
  // A zone spans whole rows rather than sitting in one, so it keeps the whole band and no row gap under it.
  return footprintRowBox({ left, width: right - left }, topY, bottomY, paint.verticalPixelRatio);
}

/** Paints one zone: its side's colour a fifth strong, edged on its top and bottom by the full colour. */
function paintStackedZone(paint: FootprintPaint, zone: PlacedStackedZone, paneWidth: number): void {
  const box = stackedZoneBox(paint, zone, paneWidth);
  if (box === null) {
    return;
  }
  const color = imbalanceMarkColor(paint.options.imbalanceHighlight, zone.side);
  paint.context.fillStyle = withOpacityPercent(color, STACKED_ZONE_FILL_PERCENT);
  paint.context.fillRect(box.left, box.top, box.width, box.height);
  paint.context.fillStyle = color;
  paint.context.fillRect(box.left, box.top, box.width, STACKED_ZONE_EDGE_WIDTH);
  paint.context.fillRect(box.left, box.top + box.height - STACKED_ZONE_EDGE_WIDTH, box.width, STACKED_ZONE_EDGE_WIDTH);
}

/** Paints one bar: its plain candle, or its cells with the thin candle among them. */
function paintFootprintBar(paint: FootprintPaint, bar: FootprintBar, marks: FootprintMarks): void {
  const footprint = bar.point.footprint;
  const style: CandleGlyphStyle = {
    colors: volumeCandleColors(paint.options, bar.point),
    wickVisible: paint.options.wickVisible,
    borderVisible: paint.options.borderVisible,
  };
  if (footprint === undefined) {
    // The host read no whole ticks for this bar, so it is a plain candle at the bar's own body width.
    paintCandle(paint.context, bar.x, paint.fullWidth, bar.prices, style, paint);
    return;
  }
  const columns = barColumns(paint, bar.x);
  paintFootprintCells(paint, footprint, columns, marks);
  paintCandle(paint.context, candleCentreX(paint, columns), columns.candle.width, bar.prices, style, paint);
  paintValueArea(paint, footprint, columns, marks);
  // The summary uses these full columns, never the profile-narrowed cell boxes painted inside them.
  paintSummary(paint, footprint, columns, marks);
}

/**
 * The custom series renderer of the volume footprint bars: each bar paints the cells the appearance's type and
 * display make of its rows — a sell column, a gap, a thin candle, another gap and a buy column, or one column beside
 * the candle — a mark on every imbalanced edge and its value area dashed. Under the columns it writes each side's
 * total against its own column, or both in one line in the single-column layout, and, while the summary is on, the
 * bar's delta and total in a box. The stacked imbalance zones are painted first, so every bar's own paint stands
 * over them. The cells are device pixels; only the text and the markers are written, in media pixels.
 */
export class VolumeFootprintRenderer extends CustomBarRenderer<VolumeFootprintPoint, VolumeFootprintOptions> {
  protected override options: VolumeFootprintOptions = VOLUME_FOOTPRINT_DEFAULT_OPTIONS;

  protected drawVisibleBars(
    target: SeriesRenderingTarget,
    priceConverter: PriceToCoordinateConverter,
    data: PaneRendererCustomData<Time, VolumeFootprintPoint>,
    visibleBars: VisibleBarIndices,
  ): void {
    const bars = plottedFootprintBars(data.bars, visibleBars, priceConverter);
    const zones = placedStackedZones(data, visibleBars, this.options);
    if (bars.length === 0 && zones.length === 0) {
      return;
    }
    const marks = this.paintBars(target, { priceConverter, barSpacing: data.barSpacing, zones, bars });
    this.paintMarks(target, marks);
  }

  /** Paints the stack zones, then the bars' cells and candles over them, collecting what the media pass writes. */
  private paintBars(target: SeriesRenderingTarget, source: FootprintPaintSource): FootprintMarks {
    const marks: FootprintMarks = { texts: [], valueAreas: [] };
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio, bitmapSize }) => {
      const paint: FootprintPaint = {
        context,
        options: this.options,
        priceConverter: source.priceConverter,
        fullWidth: barBodyWidth(source.barSpacing, horizontalPixelRatio),
        textWidth: (text) => context.measureText(text).width,
        horizontalPixelRatio,
        verticalPixelRatio,
      };
      context.save();
      // The bitmap context draws in device pixels, so its font measures the text in the css px the media pass writes.
      context.font = FOOTPRINT_FONT;
      // The zones are painted first, so the cells and candles of every bar stand over them.
      for (const zone of source.zones) {
        paintStackedZone(paint, zone, bitmapSize.width);
      }
      for (const bar of source.bars) {
        paintFootprintBar(paint, bar, marks);
      }
      context.restore();
    });
    return marks;
  }

  /** Writes the cells' numbers, the box's values in bold, and the value area markers, in media pixels. */
  private paintMarks(target: SeriesRenderingTarget, marks: FootprintMarks): void {
    if (marks.texts.length === 0 && marks.valueAreas.length === 0) {
      return;
    }
    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      context.textBaseline = 'middle';
      for (const text of marks.texts) {
        context.font = text.bold === true ? FOOTPRINT_BOLD_FONT : FOOTPRINT_FONT;
        context.textAlign = text.align;
        context.fillStyle = text.color;
        context.fillText(text.text, text.x, text.y);
      }
      context.font = FOOTPRINT_FONT;
      for (const area of marks.valueAreas) {
        paintValueAreaMarkers(context, area);
      }
      context.restore();
    });
  }
}
