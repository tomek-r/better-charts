import { expect, test } from '@playwright/test';
import { holdIdleCallbacks, expectNoErrors } from './helpers/tauriStub';
import { loadViewportWindow, pushLiveBar } from './helpers/viewportHarness';

test.beforeEach(async ({ page }) => {
  await holdIdleCallbacks(page);
});

test('every write to the time scale is recorded with the view before and after it', async ({ page }) => {
  await loadViewportWindow(page);
  await page.evaluate(() => window.__chartTest!.clearViewportChanges());

  await pushLiveBar(page);

  const changes = await page.evaluate(() => window.__chartTest!.viewportChanges());
  expect(changes.map((change) => change.caller)).toContain('extendFuture');
  expect(changes.map((change) => change.caller)).toContain('restoreViewport');
  for (const change of changes) {
    expect(change.before.range).not.toBeNull();
    expect(change.after.barCount).toBeGreaterThan(0);
    expect(change.after.barSpacing).toBeGreaterThan(0);
    expect(change.atMs).toBeGreaterThan(0);
  }
});

test('the helper point count always matches the helper series, so no assertion fires', async ({ page }) => {
  const collected = await loadViewportWindow(page);
  await pushLiveBar(page);
  await pushLiveBar(page, 3);
  expectNoErrors(collected);
});
