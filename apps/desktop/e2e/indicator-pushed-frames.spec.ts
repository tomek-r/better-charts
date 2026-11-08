import { expect, test, type Page } from '@playwright/test';

import { gotoWithStub } from './helpers/tauriStub';

/** Runtime module under test, loaded straight from source by the page. */
const RUNTIME_MODULE = '/src/features/chart/engine/indicators/indicatorRuntime.ts';

/** Definition the page attaches; its indicator is the one that hands over frames later. */
const DEFINITION_ID = 'pushed';

/** Instance the tests attach under; the runtime keys everything by instance. */
const INSTANCE_ID = 'pushed-instance';

/** A layer call recorded by the fake layer, as `[method, instanceId, value]`. */
type LayerCall = [method: string, instanceId: string, value: number | boolean];

/** A one-plot frame the tests hand to the outlet; the fake layer only reads its plot count. */
type PushedFrame = {
  readonly plots: readonly { readonly line: readonly number[] }[];
  readonly bars: readonly unknown[];
};

/** The two kinds of frame an attached indicator can hand over. */
type PushedFrameKind = 'showFrame' | 'updateFrame';

/** The handover surface the indicator receives, as the tests drive it. */
type IndicatorOutlet = {
  showFrame(frame: PushedFrame): void;
  updateFrame(frame: PushedFrame): void;
  readonly priceSeries: unknown;
};

/** What the page exposes on `window` so the tests can drive and inspect the runtime. */
type PushedFramesWindow = {
  __layerCalls: LayerCall[];
  __hiddenCalls: boolean[];
  __changedCount: number;
  __outlets: IndicatorOutlet[];
  __sentinel: unknown;
  __attach(instanceId: string): void;
  __detach(instanceId: string): void;
  __setHidden(instanceId: string, hidden: boolean): void;
  __pushFrame(outletIndex: number, kind: PushedFrameKind): void;
};

/**
 * Loads the app, then builds a real `IndicatorRuntime` in the page over a fake layer and one
 * indicator whose class keeps every outlet it is handed.
 */
async function gotoWithPushedFrames(page: Page): Promise<void> {
  await gotoWithStub(page);
  await page.evaluate(
    async ({ modulePath, definitionId }) => {
      const pageWindow = window as unknown as PushedFramesWindow;
      const runtimeModule = (await import(
        /* @vite-ignore */ modulePath
      )) as typeof import('../src/features/chart/engine/indicators/indicatorRuntime');
      const { IndicatorRuntime } = runtimeModule;

      /** Stands in for `ISeriesApi<'Candlestick'>`: the tests only compare its identity. */
      const priceSeries = { priceScale: () => ({ applyOptions: () => undefined }) };
      const emptyFrame = { plots: [], bars: [] };
      pageWindow.__layerCalls = [];
      pageWindow.__hiddenCalls = [];
      pageWindow.__changedCount = 0;
      pageWindow.__outlets = [];
      pageWindow.__sentinel = priceSeries;

      const layer = {
        show: (instanceId: string, frame: { plots: readonly unknown[] }) => {
          pageWindow.__layerCalls.push(['show', instanceId, frame.plots.length]);
        },
        update: (instanceId: string, frame: { plots: readonly unknown[] }) => {
          pageWindow.__layerCalls.push(['update', instanceId, frame.plots.length]);
        },
        remove: (instanceId: string) => {
          pageWindow.__layerCalls.push(['remove', instanceId, 0]);
        },
        setHidden: (instanceId: string, hidden: boolean) => {
          pageWindow.__layerCalls.push(['setHidden', instanceId, hidden]);
        },
      };
      const indicatorClass = class {
        load(): unknown {
          return emptyFrame;
        }
        update(): unknown {
          return emptyFrame;
        }
        connect(outlet: IndicatorOutlet): void {
          pageWindow.__outlets.push(outlet);
        }
        setHidden(hidden: boolean): void {
          pageWindow.__hiddenCalls.push(hidden);
        }
      };

      const runtime = new IndicatorRuntime(
        layer as unknown as ConstructorParameters<typeof IndicatorRuntime>[0],
        [{ id: definitionId, pane: 'overlay', indicatorClass }] as unknown as ConstructorParameters<
          typeof IndicatorRuntime
        >[1],
        () => [],
        () => {
          pageWindow.__changedCount += 1;
        },
        priceSeries as unknown as ConstructorParameters<typeof IndicatorRuntime>[4],
      );
      const seam = runtime as unknown as {
        attach(instanceId: string, definitionId: string, stored: Readonly<Record<string, never>>): boolean;
        detach(instanceId: string): void;
        setHidden(instanceId: string, hidden: boolean): void;
      };

      pageWindow.__attach = (instanceId: string) => {
        seam.attach(instanceId, definitionId, {});
      };
      pageWindow.__detach = (instanceId: string) => {
        seam.detach(instanceId);
      };
      pageWindow.__setHidden = (instanceId: string, hidden: boolean) => {
        seam.setHidden(instanceId, hidden);
      };
      pageWindow.__pushFrame = (outletIndex: number, kind: PushedFrameKind) => {
        const frame: PushedFrame = { plots: [{ line: [1] }], bars: [] };
        pageWindow.__outlets[outletIndex][kind](frame);
      };
    },
    { modulePath: RUNTIME_MODULE, definitionId: DEFINITION_ID },
  );
}

/** Loads the page and attaches the frame-handing indicator under the test instance id. */
async function gotoWithAttachedIndicator(page: Page): Promise<void> {
  await gotoWithPushedFrames(page);
  await page.evaluate((instanceId) => (window as unknown as PushedFramesWindow).__attach(instanceId), INSTANCE_ID);
}

/** A layer call the fake layer is expected to record for the test instance. */
function expectedLayerCall(method: 'show' | 'update' | 'setHidden', value: number | boolean): LayerCall {
  return [method, INSTANCE_ID, value];
}

/** Pushes a frame of the given kind through the outlet the indicator was handed first. */
async function pushThroughFirstOutlet(page: Page, kind: PushedFrameKind): Promise<void> {
  await page.evaluate(
    ({ outletIndex, frameKind }) => {
      (window as unknown as PushedFramesWindow).__pushFrame(outletIndex, frameKind);
    },
    { outletIndex: 0, frameKind: kind },
  );
}

/** The layer calls the page recorded so far. */
async function recordedLayerCalls(page: Page): Promise<LayerCall[]> {
  return page.evaluate(() => (window as unknown as PushedFramesWindow).__layerCalls);
}

/** Hides or shows the test instance through the runtime. */
async function setInstanceHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate(
    ({ instanceId, nextHidden }) => {
      (window as unknown as PushedFramesWindow).__setHidden(instanceId, nextHidden);
    },
    { instanceId: INSTANCE_ID, nextHidden: hidden },
  );
}

test('an indicator with an outlet pushes a whole frame and a live frame', async ({ page }) => {
  await gotoWithAttachedIndicator(page);
  await pushThroughFirstOutlet(page, 'showFrame');
  await pushThroughFirstOutlet(page, 'updateFrame');

  const [, ...pushedCalls] = await recordedLayerCalls(page);
  expect(pushedCalls).toEqual([expectedLayerCall('show', 1), expectedLayerCall('update', 1)]);
  // One change for the attach, then one per frame handed over.
  expect(await page.evaluate(() => (window as unknown as PushedFramesWindow).__changedCount)).toBe(3);
});

test('the outlet hands over the price series', async ({ page }) => {
  await gotoWithAttachedIndicator(page);

  const handsOverPriceSeries = await page.evaluate(() => {
    const pageWindow = window as unknown as PushedFramesWindow;
    return pageWindow.__outlets[0].priceSeries === pageWindow.__sentinel;
  });
  expect(handsOverPriceSeries).toBe(true);
});

test('a frame pushed after detach draws nothing', async ({ page }) => {
  await gotoWithAttachedIndicator(page);
  await page.evaluate((instanceId) => (window as unknown as PushedFramesWindow).__detach(instanceId), INSTANCE_ID);
  const callsBeforePushing = await recordedLayerCalls(page);

  await pushThroughFirstOutlet(page, 'showFrame');
  await pushThroughFirstOutlet(page, 'updateFrame');

  expect(callsBeforePushing.map(([method]) => method)).toContain('remove');
  expect(await recordedLayerCalls(page)).toEqual(callsBeforePushing);
});

test('a frame pushed by a replaced instance draws nothing', async ({ page }) => {
  await gotoWithAttachedIndicator(page);
  await page.evaluate((instanceId) => (window as unknown as PushedFramesWindow).__attach(instanceId), INSTANCE_ID);
  const callsBeforePushing = await recordedLayerCalls(page);

  await pushThroughFirstOutlet(page, 'showFrame');
  await pushThroughFirstOutlet(page, 'updateFrame');

  expect(await page.evaluate(() => (window as unknown as PushedFramesWindow).__outlets.length)).toBe(2);
  expect(await recordedLayerCalls(page)).toEqual(callsBeforePushing);
});

test('a hidden indicator stays hidden after a pushed frame', async ({ page }) => {
  await gotoWithAttachedIndicator(page);
  await setInstanceHidden(page, true);
  await pushThroughFirstOutlet(page, 'showFrame');

  expect(await recordedLayerCalls(page)).toEqual([
    expectedLayerCall('show', 0),
    expectedLayerCall('setHidden', true),
    expectedLayerCall('show', 1),
    expectedLayerCall('setHidden', true),
  ]);
});

test('hiding is forwarded to the indicator', async ({ page }) => {
  await gotoWithAttachedIndicator(page);
  await setInstanceHidden(page, true);
  await setInstanceHidden(page, false);

  expect(await page.evaluate(() => (window as unknown as PushedFramesWindow).__hiddenCalls)).toEqual([true, false]);
});
