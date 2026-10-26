import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import { buildChartPlugins, type ChartOverlayState } from './buildChartPlugins';
import {
  createDrawingPaintTarget,
  createDrawTarget,
  PANE_BELOW_TRADING_OVERLAYS,
  PRICE_AXIS_BELOW_TRADING_OVERLAYS,
} from './drawTarget';
import type { ChartDrawingPaintTarget, ChartDrawTarget, RenderViewport } from '../tools/toolContract';

/**
 * The render-facing surface the workspace primitive needs from the chart host:
 * the current viewport and the drawing tools' paint passes. Declared here so the
 * primitive never imports the controller that drives it.
 */
export interface WorkspaceRenderHost {
  viewport(): RenderViewport;
  /** Each tool's content for the below-trading layer, painted before every overlay in the list. */
  drawTools(target: ChartDrawTarget): void;
  /** The drawings the chart's stacking order puts under the price bars, with no overlay of this list. */
  drawDrawingsBelowBars(target: ChartDrawingPaintTarget): void;
}

/**
 * One primitive owns paint ordering in both the pane and its price axis.
 *
 * The pane has two views, so a drawing paints on the side of the candle series the
 * chart's stacking order puts it on: the `bottom` view carries the drawings stacked
 * below the bars, the `top` view the ones above them. The overlay list is built once,
 * here, so the overlays keep receiving the live state refs the app mutates. In the
 * `top` view the drawings paint first (e.g. a profile fill and then its selection
 * handles), which places them below every ui-layer row.
 */
export class WorkspacePrimitive implements ISeriesPrimitive {
  requestUpdate?: () => void;
  private readonly pane: readonly IPrimitivePaneView[];
  private readonly axis: readonly IPrimitivePaneView[];
  constructor(host: WorkspaceRenderHost, state: ChartOverlayState) {
    const overlays = buildChartPlugins(state);
    const belowBars: IPrimitivePaneRenderer = {
      draw(renderTarget) {
        renderTarget.useMediaCoordinateSpace(({ context }) => {
          host.drawDrawingsBelowBars(createDrawingPaintTarget(renderTarget, context, host.viewport()));
        });
      },
    };
    const withOverlays = (axis: boolean): IPrimitivePaneRenderer => ({
      draw(renderTarget) {
        renderTarget.useMediaCoordinateSpace(({ context }) => {
          const viewport = host.viewport();
          context.save();
          if (axis) {
            context.translate(-viewport.chartRect.width, 0);
          }
          const layer = axis ? PRICE_AXIS_BELOW_TRADING_OVERLAYS : PANE_BELOW_TRADING_OVERLAYS;
          host.drawTools(createDrawTarget(renderTarget, context, viewport, layer));
          for (const overlay of overlays) {
            context.save();
            overlay.render(context, { viewport });
            context.restore();
          }
          context.restore();
        });
      },
    });
    this.pane = [
      { zOrder: () => 'bottom', renderer: () => belowBars },
      { zOrder: () => 'top', renderer: () => withOverlays(false) },
    ];
    this.axis = [{ zOrder: () => 'top', renderer: () => withOverlays(true) }];
  }
  attached({ requestUpdate }: SeriesAttachedParameter): void {
    this.requestUpdate = requestUpdate;
  }
  detached(): void {
    this.requestUpdate = undefined;
  }
  paneViews(): readonly IPrimitivePaneView[] {
    return this.pane;
  }
  priceAxisPaneViews(): readonly IPrimitivePaneView[] {
    return this.axis;
  }
}
