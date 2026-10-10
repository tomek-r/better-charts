import { expect, test } from '@playwright/test';
import { gotoWithStub } from './helpers/tauriStub';

type SetupGuideSave = { resource: string; destination: string };

test.describe('bridge connection setup guide', () => {
  test('info icon opens a numbered guide with downloadable EA and indicator', async ({ page }) => {
    await gotoWithStub(page);
    await page.getByRole('button', { name: 'App settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'App settings' });
    await expect(dialog).toBeVisible();

    const trigger = dialog.getByRole('button', { name: 'How to set up the bridge connection' });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();

    const guide = page.getByRole('dialog', { name: 'Set up the MT5 bridge' });
    await expect(guide).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(guide.getByRole('button', { name: 'Close setup guide' })).toBeFocused();

    // The five numbered steps.
    await expect(guide.locator('.setup-guide-steps li')).toHaveCount(5);

    // Both bundled files are offered as simple download links below step 1, enabled
    // because the shell is available (isTauri is true in the stub).
    const ea = guide.locator('.setup-guide-download[data-resource="mql5/Experts/BetterChartsBridge.mq5"]');
    const reader = guide.locator(
      '.setup-guide-download[data-resource="mql5/Indicators/BetterChartsTickHistoryReader.mq5"]',
    );
    await expect(ea).toBeEnabled();
    await expect(reader).toBeEnabled();
    await expect(ea).toContainText('BetterChartsBridge.mq5');
    await expect(reader).toContainText('BetterChartsTickHistoryReader.mq5');

    // Clicking a download opens the save dialog (scripted by the stub) and copies the
    // bundled resource to the chosen path via the save_bundled_resource command.
    await ea.click();
    await expect
      .poll(() =>
        page.evaluate(() => ((window as { __setupGuideSaves?: SetupGuideSave[] }).__setupGuideSaves ?? []).length),
      )
      .toBe(1);
    const saves = await page.evaluate(() => (window as { __setupGuideSaves?: SetupGuideSave[] }).__setupGuideSaves);
    expect(saves?.[0]).toEqual({
      resource: 'mql5/Experts/BetterChartsBridge.mq5',
      destination: '/chosen/BetterChartsBridge.mq5',
    });

    // Escape closes only the guide; the settings dialog stays open; focus returns to the trigger.
    await page.keyboard.press('Escape');
    await expect(guide).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(trigger).toBeFocused();

    // Reopen, then dismiss via the guide's own close button.
    await trigger.click();
    await expect(guide).toBeVisible();
    await guide.getByRole('button', { name: 'Close setup guide' }).click();
    await expect(guide).toBeHidden();
    await expect(dialog).toBeVisible();
  });
});
