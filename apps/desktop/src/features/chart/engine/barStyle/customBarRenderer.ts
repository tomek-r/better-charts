import type {
  CustomData,
  ICustomSeriesPaneRenderer,
  PaneRendererCustomData,
  PriceToCoordinateConverter,
  Time,
} from 'lightweight-charts';

/** The canvas a custom series paints on, as the library's renderer signature hands it over. */
export type SeriesRenderingTarget = Parameters<ICustomSeriesPaneRenderer['draw']>[0];

/** A visible window of bars, as indices into the pane data's bars. */
export interface VisibleBarIndices {
  readonly from: number;
  readonly to: number;
}

/**
 * The part the custom bar renderers share: the library hands each paint its bars and options through
 * `update`, and a paint whose bars or visible window it does not have yet is dropped before any drawing.
 * Each bar style then paints the visible bars of one such paint its own way.
 */
export abstract class CustomBarRenderer<Point extends CustomData<Time>, Options> implements ICustomSeriesPaneRenderer {
  /** The options the paints are drawn with, which open at the style's own defaults. */
  protected abstract options: Options;

  private data: PaneRendererCustomData<Time, Point> | null = null;

  update(data: PaneRendererCustomData<Time, Point>, options: Options): void {
    this.data = data;
    this.options = options;
  }

  draw(target: SeriesRenderingTarget, priceConverter: PriceToCoordinateConverter): void {
    const data = this.data;
    if (data === null) {
      return;
    }
    const visibleBars = data.visibleRange;
    if (visibleBars === null) {
      return;
    }
    this.drawVisibleBars(target, priceConverter, data, visibleBars);
  }

  /** Paints the bars of the visible window, in the bars' own order. */
  protected abstract drawVisibleBars(
    target: SeriesRenderingTarget,
    priceConverter: PriceToCoordinateConverter,
    data: PaneRendererCustomData<Time, Point>,
    visibleBars: VisibleBarIndices,
  ): void;
}
