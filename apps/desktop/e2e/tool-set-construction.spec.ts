import { expect, test, type Page } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';

/**
 * Loads the app (for the Vite server and the Tauri stub), then builds a bare chart controller.
 * `toolIds` replaces the registry with id-only definitions: enough for the validation errors,
 * which are thrown before any tool is built.
 */
async function buildBareChart(page: Page, defaultToolId: string, toolIds?: string[]) {
  await gotoWithStub(page);
  return page.evaluate(
    async ({ defaultToolId, toolIds }) => {
      const path = '/e2e/helpers/defaultToolHarness.ts';
      const { mountChartWithDefaultTool } = await import(/* @vite-ignore */ path);
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;inset:0;width:600px;height:400px';
      document.body.append(container);
      try {
        const controller = mountChartWithDefaultTool(
          container,
          defaultToolId,
          toolIds?.map((id) => ({ id })),
        );
        const cursor = container.style.cursor;
        controller.destroy();
        return { error: null as string | null, cursor };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error), cursor: '' };
      } finally {
        container.remove();
      }
    },
    { defaultToolId, toolIds },
  );
}

test('a default tool whose activate repaints builds without touching unassigned controller state', async ({ page }) => {
  const result = await buildBareChart(page, 'crosshair');
  expect(result.error).toBeNull();
  // The default tool's cursor is applied once construction finished.
  expect(result.cursor).toBe('crosshair');
});

test('the tool set rejects duplicate tool ids', async ({ page }) => {
  const result = await buildBareChart(page, 'a', ['a', 'a']);
  expect(result.error).toContain('"a" is registered more than once');
});

test('the tool set rejects an unregistered default tool', async ({ page }) => {
  const result = await buildBareChart(page, 'missing', ['a', 'b']);
  expect(result.error).toContain('Default chart tool "missing" is not registered');
});
