import { expect, test } from '@playwright/test';
import { gotoWithStub, pushEvent, stubInvocations } from './tauriStub';

test('closed panel defers ticket UI while chart updates stay active and drafts survive toggles', async ({ page }) => {
  const { pageErrors, consoleErrors } = await gotoWithStub(page);
  const panel = page.locator('aside.trade-panel');
  const ticket = panel.locator('.order-ticket');
  await expect(panel).toHaveCount(1);
  await expect(ticket).toHaveCount(0);
  await expect(page.locator('.chart-heading h1')).toHaveText('EURUSD');
  await pushEvent(page, 'quote-update', {
    symbol: 'EURUSD',
    timeMs: 1745700001000,
    bid: '1.2345',
    ask: '1.2347',
    last: '1.2345',
    volume: 10,
    volumeReal: '0',
    flags: 0,
  });
  await expect(page.locator('.chart-section .quote-cards').first()).toContainText('1.2345');
  const toggle = page.getByRole('button', { name: 'Toggle trade panel' });
  await toggle.click();
  await expect(ticket).toBeVisible();
  await expect(ticket.getByRole('group', { name: 'Order side' })).toContainText('1.2345');
  const units = ticket.getByRole('spinbutton', { name: 'Units', exact: true });
  await units.fill('2');
  await toggle.click();
  await expect(panel).toBeHidden();
  await expect(ticket).toHaveCount(1);
  await toggle.click();
  await expect(ticket).toBeVisible();
  await expect(units).toHaveValue('2');
  expect((await stubInvocations(page)).filter(({ cmd }) => cmd === 'submit_order')).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
