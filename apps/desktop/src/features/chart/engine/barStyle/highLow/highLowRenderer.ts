import type { CustomBarItemData, PaneRendererCustomData, PriceToCoordinateConverter, Time } from 'lightweight-charts';
import { barBodyWidth, deviceBarBox, strokeBodyOutline } from '../barBodyWidth';
import { CustomBarRenderer, type SeriesRenderingTarget, type VisibleBarIndices } from '../customBarRenderer';
import { HIGH_LOW_DEFAULT_OPTIONS, type HighLowOptions } from './highLowOptions';
import type { HighLowPoint } from './highLowPoint';

/** The font the price labels are written in, which is the chart's own default at its label size. */
const LABEL_FONT = '11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';

/** How far above the box the high label sits, and how far below it the low one, in media pixels. */
const LABEL_GAP = 2;

/** One bar's box and its two prices, as media pixels. */
interface HighLowGeometry {
  readonly x: number;
  readonly high: number;
  readonly low: number;
  readonly highY: number;
  readonly lowY: number;
}

/** One price label: what it says, where its box edge sits and which edge that is. */
interface PriceLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly baseline: CanvasTextBaseline;
}

/** The visible bars the price scale can place, in the order they are drawn. */
function plottedHighLowBars(
  bars: readonly CustomBarItemData<Time, HighLowPoint>[],
  visibleBars: VisibleBarIndices,
  priceConverter: PriceToCoordinateConverter,
): HighLowGeometry[] {
  const plotted: HighLowGeometry[] = [];
  for (let index = visibleBars.from; index < visibleBars.to; index += 1) {
    const bar = bars[index];
    if (bar === undefined) {
      continue;
    }
    const { high, low } = bar.originalData;
    const highY = priceConverter(high);
    const lowY = priceConverter(low);
    if (highY === null || lowY === null) {
      continue;
    }
    plotted.push({ x: bar.x, high, low, highY, lowY });
  }
  return plotted;
}

/** Writes a price label, unless its bar is too narrow for the label not to reach its neighbours'. */
function drawPriceLabel(context: CanvasRenderingContext2D, barSpacing: number, label: PriceLabel): void {
  if (context.measureText(label.text).width > barSpacing) {
    return;
  }
  context.textBaseline = label.baseline;
  context.fillText(label.text, label.x, label.y);
}

/**
 * The custom series renderer of the high-low bars: a box from each bar's low to its high, with the two
 * prices written above and below it. The boxes are device pixels and the labels media pixels, so each is
 * painted in the coordinate space it belongs to.
 */
export class HighLowRenderer extends CustomBarRenderer<HighLowPoint, HighLowOptions> {
  protected override options: HighLowOptions = HIGH_LOW_DEFAULT_OPTIONS;

  protected drawVisibleBars(
    target: SeriesRenderingTarget,
    priceConverter: PriceToCoordinateConverter,
    data: PaneRendererCustomData<Time, HighLowPoint>,
    visibleBars: VisibleBarIndices,
  ): void {
    const plotted = plottedHighLowBars(data.bars, visibleBars, priceConverter);
    if (plotted.length === 0) {
      return;
    }
    this.drawBoxes(target, data.barSpacing, plotted);
    this.drawLabels(target, data.barSpacing, plotted);
  }

  private drawBoxes(target: SeriesRenderingTarget, barSpacing: number, plotted: readonly HighLowGeometry[]): void {
    const { body, borders } = this.options;
    target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio, verticalPixelRatio }) => {
      context.save();
      const bodyWidth = barBodyWidth(barSpacing, horizontalPixelRatio);
      for (const bar of plotted) {
        const box = deviceBarBox(bar.x, bodyWidth, bar.highY, bar.lowY, { horizontalPixelRatio, verticalPixelRatio });
        if (body.visible) {
          context.fillStyle = body.color;
          context.fillRect(box.left, box.top, box.width, box.height);
        }
        if (borders.visible) {
          context.strokeStyle = borders.color;
          strokeBodyOutline(context, box);
        }
      }
      context.restore();
    });
  }

  private drawLabels(target: SeriesRenderingTarget, barSpacing: number, plotted: readonly HighLowGeometry[]): void {
    const labels = this.options.labels;
    if (!labels.visible) {
      return;
    }
    const precision = this.options.labelPrecision;
    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      context.font = LABEL_FONT;
      context.fillStyle = labels.color;
      context.textAlign = 'center';
      for (const bar of plotted) {
        const highLabel: PriceLabel = {
          text: bar.high.toFixed(precision),
          x: bar.x,
          y: bar.highY - LABEL_GAP,
          baseline: 'bottom',
        };
        const lowLabel: PriceLabel = {
          text: bar.low.toFixed(precision),
          x: bar.x,
          y: bar.lowY + LABEL_GAP,
          baseline: 'top',
        };
        drawPriceLabel(context, barSpacing, highLabel);
        drawPriceLabel(context, barSpacing, lowLabel);
      }
      context.restore();
    });
  }
}
