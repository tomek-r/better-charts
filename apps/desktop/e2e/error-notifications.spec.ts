import { expect, test } from '@playwright/test';
import { gotoWithStub, pushCommandError, pushEvent } from './tauriStub';

test('bridge errors appear at bottom right and remain dismissible after recovery', async ({ page }) => {
  const errors = await gotoWithStub(page);
  await pushEvent(page, 'bridge-status', { state: 'protocol_error', message: 'invalid account snapshot' });
  const notice = page.locator('.notification-region [role=alert]').filter({ hasText: 'Invalid account snapshot' });
  await expect(notice).toBeVisible();
  const bounds = await notice.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.x + bounds!.width).toBeGreaterThan(viewport.width - 30);
  expect(bounds!.y + bounds!.height).toBeGreaterThan(viewport.height - 30);
  await pushEvent(page, 'bridge-status', { state: 'connected', message: 'Bridge connected.' });
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Dismiss error notification' }).click();
  await expect(notice).toBeHidden();
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});

test('broker errors are capitalized, prominent and keyboard dismissible at desktop and narrow widths', async ({
  page,
}, testInfo) => {
  const errors = await gotoWithStub(page);
  await pushCommandError(page, { code: 'invalid_volume', message: 'normalized volume is below broker minimum' });
  const notice = page.locator('.notification-region [role=alert]');
  await expect(notice).toHaveText('Normalized volume is below broker minimum');
  await expect(notice.locator('.notification-icon-error')).toBeVisible();
  await expect(notice).toHaveCSS('font-size', '13px');
  await expect(notice).toHaveCSS('color', 'rgb(242, 245, 250)');
  await expect(notice).toHaveCSS('opacity', '1');
  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = (await notice.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
    await page.screenshot({ path: testInfo.outputPath(`error-notification-${width}.png`) });
  }
  await notice.getByRole('button', { name: 'Dismiss error notification' }).focus();
  await page.keyboard.press('Enter');
  await expect(notice).toBeHidden();
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});

test('duplicate errors share one notification and the stack stays bounded', async ({ page }) => {
  const errors = await gotoWithStub(page);
  for (let i = 0; i < 3; i++) {
    await pushCommandError(page, { code: 'test_error', message: 'Repeated broker error.' });
  }
  const notices = page.locator('.notification-region [role=alert]');
  await expect(notices.filter({ hasText: 'Repeated broker error.' })).toHaveCount(1);
  for (let i = 0; i < 6; i++) {
    await pushCommandError(page, { code: 'test_error', message: `Broker error ${i}.` });
  }
  await expect(notices).toHaveCount(5);
  await expect(notices.filter({ hasText: 'Broker error 5.' })).toBeVisible();
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([]);
});
