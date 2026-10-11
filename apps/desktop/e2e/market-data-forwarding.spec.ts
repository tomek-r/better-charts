import { expect, test } from '@playwright/test';
import { gotoWithStub, pushEvent } from './helpers/tauriStub';

/**
 * The market runtime forwards the profile events it accepted into the market data port
 * that chart tools read from. A run that has ended must publish nothing, so a late event
 * can never reach a tool that belongs to the next run.
 */

const profileWindow = { symbol: 'EURUSD', fromMs: 1, endMs: 2 };
const result = { ...profileWindow, complete: true, bins: [] };

test('profile events are forwarded while the run is live and dropped once it is disposed', async ({ page }) => {
  await gotoWithStub(page);
  await page.evaluate(async () => {
    const path = '/e2e/helpers/marketDataForwardingHarness.ts';
    const { startMarketDataForwarding } = await import(/* @vite-ignore */ path);
    (globalThis as Record<string, unknown>).forwarding = await startMarketDataForwarding();
  });
  const received = () =>
    page.evaluate(() => ((globalThis as Record<string, unknown>).forwarding as { received: string[] }).received);

  await pushEvent(page, 'tick-profile', result);
  await pushEvent(page, 'tick-profile-cancelled', profileWindow);
  await pushEvent(page, 'tick-profile-error', { ...profileWindow, message: 'boom' });
  expect(await received()).toEqual(['profile:EURUSD', 'cancelled:EURUSD', 'error:EURUSD']);

  await page.evaluate(() => ((globalThis as Record<string, unknown>).forwarding as { endRun(): void }).endRun());
  await pushEvent(page, 'tick-profile', result);
  await pushEvent(page, 'tick-profile-cancelled', profileWindow);
  await pushEvent(page, 'tick-profile-error', { ...profileWindow, message: 'late' });
  expect(await received()).toEqual(['profile:EURUSD', 'cancelled:EURUSD', 'error:EURUSD']);
});
