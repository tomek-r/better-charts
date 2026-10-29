import { ChartController } from '../../src/features/chart/engine/surface/chartController';
import { arrowPlugin } from '../../src/features/tools/arrow/arrowPlugin';
import { crosshairPlugin } from '../../src/features/tools/crosshair/crosshairPlugin';
import { fixedRangeProfilePlugin } from '../../src/features/tools/fixedRangeProfile/fixedRangeProfilePlugin';
import type { ChartToolDefinition } from '../../src/features/chart/engine/tools/toolContract';

const NO_MARKET_DATA = {
  requestTickProfile: () => undefined,
  cancelTickProfile: () => undefined,
  onTickProfile: () => () => undefined,
  onTickProfileCancelled: () => () => undefined,
  onTickProfileError: () => () => undefined,
};

/**
 * Builds a bare chart controller with the given default tool, outside the app. The tool
 * registry is not the app's default, so a spec can pick a default whose `activate` repaints
 * while the controller is still being constructed.
 */
export function mountChartWithDefaultTool(
  container: HTMLDivElement,
  defaultToolId: string,
  toolDefinitions: readonly ChartToolDefinition[] = [arrowPlugin, crosshairPlugin, fixedRangeProfilePlugin],
): ChartController {
  return new ChartController(
    container,
    {
      positions: { positions: [], orders: [], digits: 2, drag: null, hit: {} },
      staged: { order: null, digits: 2, hit: {} },
      priceLines: { digits: 2, hit: {} },
    },
    {
      currentMarket: { symbol: () => undefined, quote: () => undefined },
      marketDataPort: NO_MARKET_DATA,
      notifyError: () => undefined,
      toolDefinitions,
      defaultToolId,
    },
  );
}
