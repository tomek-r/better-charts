import type { PriceScaleMode } from 'lightweight-charts';
import type { RenderBar } from './mt5DataAdapter';
import type { PointerReadout } from './pointerReadoutPrimitive';

/**
 * The development-only test hook the e2e suite drives (see e2e/README.md).
 *
 * Every member is an arrow accessor rather than a method reference, so each call
 * reads live chart state, and every value it returns is a primitive, a plain
 * copy or a chart-library scalar — never a chart-library object.
 *
 * `import.meta.env.DEV` gates the install at its call site in ChartController, so
 * a production bundle contains none of this. `tool(id)` hands back the tool's own
 * `testApi()`, so a tool's test surface lives with the tool, not here.
 */
export interface DevTestApi {
  data(): readonly RenderBar[];
  visibleRange(): { from: number; to: number } | null;
  scrollToRange(range: { from: number; to: number }): void;
  timeToX(timeMs: number): number;
  tool(id: string): unknown;
  /** The pointer's time/price labels, shown for every tool; null while no pointer is over the pane. */
  pointerReadout(): PointerReadout | null;
  priceScale(): {
    autoScale: boolean;
    mode: PriceScaleMode;
    axisWidth: number;
    paneHeight: number;
    timeAxisHeight: number;
    range: { from: number; to: number } | null;
  };
}

export function installDevTestApi(api: DevTestApi): void {
  (window as unknown as { __chartTest?: DevTestApi }).__chartTest = api;
}

export function removeDevTestApi(): void {
  delete (window as unknown as { __chartTest?: unknown }).__chartTest;
}
