import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
} from 'lightweight-charts';
import { buildChartPlugins, type ChartOverlayState } from './overlays';
import type { WorkspaceRenderHost } from './overlayTypes';

/**
 * One primitive owns paint ordering in both the pane and its price axis.
 *
 * The overlay list is built once, here, so the plugins keep receiving the live
 * state refs the app mutates. The selection lines are drawn inside the plugin
 * loop after each overlay-layer plugin, which is what places them above the
 * profile fill and below every ui-layer row.
 */
export class WorkspacePrimitive implements ISeriesPrimitive {
  requestUpdate?: () => void;
  private readonly pane: readonly IPrimitivePaneView[];
  private readonly axis: readonly IPrimitivePaneView[];
  constructor(host: WorkspaceRenderHost, state: ChartOverlayState) {
    const overlays = buildChartPlugins(state);
    const renderer = (axis: boolean): IPrimitivePaneRenderer => ({
      draw(target) {
        target.useMediaCoordinateSpace(({ context }) => {
          const viewport = host.viewport();
          context.save();
          if (axis) {
            context.translate(-viewport.chartRect.width, 0);
          }
          for (const { plugin } of overlays) {
            context.save();
            plugin.render(context, { viewport });
            context.restore();
            if (plugin.descriptor.layer === 'overlay' && !axis) {
              host.drawSelection(context);
            }
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
