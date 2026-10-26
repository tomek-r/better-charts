import type { Page } from '@playwright/test';
import type { DevTestApi } from '../../src/features/chart/engine/surface/devTestApi';
import type { CrosshairTestApi } from '../../src/features/tools/crosshair/tool';
import type { FixedRangeProfileTestApi } from '../../src/features/tools/fixedRangeProfile/tool';

/** Each tool's dev test API, keyed by tool id: the one place a spec learns what `tool(id)` returns. */
interface ToolTestApis {
  crosshair: CrosshairTestApi;
  fixedRangeProfile: FixedRangeProfileTestApi;
}

type ChartTestHook = Omit<DevTestApi, 'tool'> & {
  tool<Id extends keyof ToolTestApis>(id: Id): ToolTestApis[Id] | undefined;
};

/**
 * The DEV-only chart hook, declared once from its own source of truth.
 *
 * Specs used to restate the members they called, and three of them restated
 * `timeToX` as returning `number | null` while the implementation returns `NaN`
 * for "no coordinate" — a claim nothing could catch, because `e2e/` sat outside
 * the typecheck program. Typing `window.__chartTest` here keeps one definition
 * and, now that the program includes this directory, turns any divergence into a
 * typecheck failure.
 *
 * This file is in `e2e/`, so production code cannot see the augmentation: `src`
 * never touches `window.__chartTest` outside devTestApi's own installer.
 */
declare global {
  interface Window {
    __chartTest?: ChartTestHook;
  }
}

/** The Fixed Range Volume Profile tool's dev test surface, or null before the chart mounted. */
export async function profileBoundaries(page: Page) {
  return page.evaluate(() => window.__chartTest?.tool('fixedRangeProfile')?.boundaries() ?? null);
}

/** The profile tool's selection, or null before the chart mounted. */
export async function profileSelection(page: Page) {
  return page.evaluate(() => window.__chartTest?.tool('fixedRangeProfile')?.selection() ?? null);
}
