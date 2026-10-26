import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import { buildChartPlugins, type ChartOverlayState } from '../trading/overlays';
import { createDrawTarget, PANE_BELOW_TRADING_OVERLAYS, PRICE_AXIS_BELOW_TRADING_OVERLAYS } from './drawTarget';
import type { ChartDrawTarget, RenderViewport } from '../tools/toolContract';

/**
 * The render-facing surface the workspace primitive needs from the chart host:
 * the current viewport and the drawing tools' paint pass. Declared here so the
 * primitive never imports the controller that drives it.
 */
export interface WorkspaceRenderHost {
  viewport(): RenderViewport;
  /** Each tool's content for the below-trading layer, painted before every plugin in the list. */
  drawTools(target: ChartDrawTarget): void;
}

/**
 * One primitive owns paint ordering in both the pane and its price axis.
 *
 * The overlay list is built once, here, so the plugins keep receiving the live
 * state refs the app mutates. The drawing tools paint first (their content, e.g. a
 * profile fill and then its selection handles), which places it below every
 * ui-layer row.
 */
export class WorkspacePrimitive implements ISeriesPrimitive {
  requestUpdate?: () => void;
  private readonly pane: readonly IPrimitivePaneView[];
  private readonly axis: readonly IPrimitivePaneView[];
  constructor(host: WorkspaceRenderHost, state: ChartOverlayState) {
    const overlays = buildChartPlugins(state);
    const renderer = (axis: boolean): IPrimitivePaneRenderer => ({
      draw(renderTarget) {
        renderTarget.useMediaCoordinateSpace(({ context }) => {
          const viewport = host.viewport();
          context.save();
          if (axis) {
            context.translate(-viewport.chartRect.width, 0);
          }
          const layer = axis ? PRICE_AXIS_BELOW_TRADING_OVERLAYS : PANE_BELOW_TRADING_OVERLAYS;
          host.drawTools(createDrawTarget(renderTarget, context, viewport, layer));
          for (const { plugin } of overlays) {
            context.save();
            plugin.render(context, { viewport });
            context.restore();
          }
          context.restore();
        });
      },
    });
    this.pane = [{ zOrder: () => 'top', renderer: () => renderer(false) }];
    this.axis = [{ zOrder: () => 'top', renderer: () => renderer(true) }];
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
