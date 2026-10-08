import { test, expect, type Locator } from '@playwright/test';
import { gotoWithStub, stubInvocations } from './tauriStub';
import type { AppSettingsData } from '../src/features/settings/settingsTypes';

const firstLaunch: AppSettingsData = {
  mt5BridgeSettings: {
    token: '',
    address: '127.0.0.1:8765',
    maxFrameBytes: 8388608, // config/bridge.json's default, asserted as a literal
    tradingEnabled: false,
    autoStartMt5: false,
    terminalPath: '',
    winePrefix: '',
    wineBinary: '',
    configPath: '',
  },
  configured: false,
  firstLaunch: true,
  restartRequired: false,
  platform: 'linux',
  overriddenKeys: [],
  configurationError: null,
};

for (const outcome of ['resolve', 'reject'] as const) {
  test(`initial settings loading keeps the modal usable when the request ${outcome}s`, async ({ page }) => {
    await page.addInitScript(() => {
      type Internals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      const w = window as unknown as {
        __TAURI_INTERNALS__?: Internals;
        __pendingSettingsReads: Array<{ resolve: (value: unknown) => void; reject: () => void }>;
      };
      w.__pendingSettingsReads = [];
      const wrap = (value: Internals) => {
        const original = value.invoke;
        value.invoke = (cmd, args) => {
          if (cmd === 'get_app_settings') {
            return new Promise((resolve, reject) => {
              w.__pendingSettingsReads.push({ resolve, reject: () => reject(new Error('test read failed')) });
            });
          }
          return original(cmd, args);
        };
        return value;
      };
      let internals = w.__TAURI_INTERNALS__ ? wrap(w.__TAURI_INTERNALS__) : undefined;
      Object.defineProperty(window, '__TAURI_INTERNALS__', {
        configurable: true,
        get: () => internals,
        set: (value: Internals) => {
          internals = wrap(value);
        },
      });
    });
    await gotoWithStub(page);
    const gear = page.getByRole('button', { name: 'App settings', exact: true });
    const dialog = page.getByRole('dialog', { name: 'App settings' });
    await gear.click();
    await expect(dialog.getByRole('status')).toHaveText('Loading settings…');
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close settings' })).toBeFocused();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Search symbols' })).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await gear.click();
    await expect(dialog.getByRole('status')).toHaveText('Loading settings…');
    const loaded = {
      ...firstLaunch,
      firstLaunch: false,
      configured: true,
      mt5BridgeSettings: { ...firstLaunch.mt5BridgeSettings, token: 'current-settings' },
    };
    await page.evaluate(
      ({ result, settings }) => {
        const reads = (
          window as unknown as {
            __pendingSettingsReads: Array<{ resolve: (value: unknown) => void; reject: () => void }>;
          }
        ).__pendingSettingsReads;
        const current = reads[reads.length - 1];
        if (result === 'resolve') {
          current.resolve(settings);
        } else {
          current.reject();
        }
      },
      { result: outcome, settings: loaded },
    );
    await expect(dialog.getByRole('status')).toHaveCount(0);
    if (outcome === 'resolve') {
      await expect(dialog.getByLabel('Token', { exact: true })).toHaveValue('current-settings');
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    } else {
      await expect(page.getByRole('alert')).toContainText('Could not load app settings.');
      await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    }
    await dialog.getByRole('button', { name: 'Close settings' }).click();
    await expect(dialog).toBeHidden();
  });
}

async function expectBannerTextUncovered(banner: Locator) {
  await expect(banner).toBeVisible();
  const clearsRail = await banner.evaluate((element) => {
    const rail = document.querySelector('.tool-rail');
    return rail !== null && element.getBoundingClientRect().left >= rail.getBoundingClientRect().right;
  });
  expect(clearsRail).toBe(true);
  const uncovered = await banner.evaluate((element) => {
    const text = document.createRange();
    text.selectNodeContents(element);
    const box = text.getBoundingClientRect();
    const topmost = document.elementFromPoint(box.left + 4, box.top + box.height / 2);
    return topmost === element || (topmost !== null && element.contains(topmost));
  });
  expect(uncovered).toBe(true);
}

test('settings notifications stack in the bottom right and clear drawing tools at small viewports', async ({
  page,
}) => {
  await gotoWithStub(page, {
    responses: {
      get_app_settings: {
        ...firstLaunch,
        firstLaunch: false,
        restartRequired: true,
        configurationError: 'Invalid environment configuration. Fix the override and restart.',
      },
    },
  });
  await page.getByRole('dialog', { name: 'App settings' }).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeHidden();
  for (const width of [390, 1280]) {
    for (const height of [480, 800]) {
      await page.setViewportSize({ width, height });
      await expectBannerTextUncovered(page.getByRole('alert'));
      await expect(page.getByRole('alert')).toHaveCSS('color', 'rgb(242, 245, 250)');
      await expectBannerTextUncovered(page.getByRole('status').filter({ hasText: 'Restart Better Charts' }));
      await expect(page.getByRole('status').filter({ hasText: 'Restart Better Charts' })).toHaveCSS(
        'color',
        'rgb(196, 201, 208)',
      );
      const region = page.locator('.notification-region');
      await expect(region).toHaveCSS('position', 'absolute');
      const box = await region.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x + box!.width).toBe(width - 16);
      expect(box!.y + box!.height).toBe(height - 16);
      const alert = await page.getByRole('alert').boundingBox();
      const status = await page.getByRole('status').filter({ hasText: 'Restart Better Charts' }).boundingBox();
      expect(alert!.y + alert!.height).toBeLessThan(status!.y);
    }
  }
});

test('saving settings shows a dark shadowed notification without moving the chart', async ({ page }) => {
  await gotoWithStub(page);
  const chart = page.locator('.chart-section');
  const before = await chart.boundingBox();
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  const notice = page.getByRole('status').filter({ hasText: 'Restart Better Charts' });
  await expect(notice).toHaveCSS('background-color', 'rgb(18, 25, 35)');
  await expect(notice).not.toHaveCSS('box-shadow', 'none');
  expect(await chart.boundingBox()).toEqual(before);
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await expect(dialog).toBeVisible();
  const modalAboveNotice = await notice.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return topmost !== null && topmost.closest('.settings-backdrop') !== null;
  });
  expect(modalAboveNotice).toBe(true);
});

test('older settings reads cannot overwrite a newer result after close and reopen', async ({ page }) => {
  await gotoWithStub(page);
  await expect
    .poll(async () => (await stubInvocations(page)).filter(({ cmd }) => cmd === 'get_app_settings').length)
    .toBe(2);
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      __settingsReadResolvers: Array<(value: unknown) => void>;
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__settingsReadResolvers = [];
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === 'get_app_settings') {
        return new Promise((resolve) => w.__settingsReadResolvers.push(resolve));
      }
      return original(cmd, args);
    };
  });

  const gear = page.getByRole('button', { name: 'App settings', exact: true });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await gear.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __settingsReadResolvers: unknown[] }).__settingsReadResolvers.length),
    )
    .toBe(1);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();

  await gear.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __settingsReadResolvers: unknown[] }).__settingsReadResolvers.length),
    )
    .toBe(2);
  const newerSettings = {
    ...firstLaunch,
    mt5BridgeSettings: { ...firstLaunch.mt5BridgeSettings, token: 'newer-token' },
    configurationError: 'Newer settings read was accepted.',
  };
  await page.evaluate((settings) => {
    (window as unknown as { __settingsReadResolvers: Array<(value: unknown) => void> }).__settingsReadResolvers[1](
      settings,
    );
  }, newerSettings);
  await expect(page.getByRole('alert')).toContainText('Newer settings read was accepted.');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();

  const olderSettings = {
    ...firstLaunch,
    mt5BridgeSettings: { ...firstLaunch.mt5BridgeSettings, token: 'older-token' },
  };
  await page.evaluate((settings) => {
    (window as unknown as { __settingsReadResolvers: Array<(value: unknown) => void> }).__settingsReadResolvers[0](
      settings,
    );
  }, olderSettings);
  await expect(page.getByRole('alert')).toContainText('Newer settings read was accepted.');

  await gear.click();
  await expect(dialog.getByLabel('Token', { exact: true })).toHaveValue('newer-token');
});

test('a settings read started before save cannot overwrite the saved settings', async ({ page }) => {
  await gotoWithStub(page);
  await expect
    .poll(async () => (await stubInvocations(page)).filter(({ cmd }) => cmd === 'get_app_settings').length)
    .toBe(2);
  await page.evaluate(() => {
    const w = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      __settingsReadResolvers: Array<(value: unknown) => void>;
    };
    const original = w.__TAURI_INTERNALS__.invoke;
    w.__settingsReadResolvers = [];
    w.__TAURI_INTERNALS__.invoke = (cmd, args) => {
      if (cmd === 'get_app_settings') {
        return new Promise((resolve) => w.__settingsReadResolvers.push(resolve));
      }
      return original(cmd, args);
    };
  });

  const gear = page.getByRole('button', { name: 'App settings', exact: true });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await gear.click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __settingsReadResolvers: unknown[] }).__settingsReadResolvers.length),
    )
    .toBe(1);
  await dialog.getByLabel('Token', { exact: true }).fill('saved-token');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();

  const olderSettings = {
    ...firstLaunch,
    mt5BridgeSettings: { ...firstLaunch.mt5BridgeSettings, token: 'older-token' },
  };
  await page.evaluate((settings) => {
    (window as unknown as { __settingsReadResolvers: Array<(value: unknown) => void> }).__settingsReadResolvers[0](
      settings,
    );
  }, olderSettings);
  await expect(page.getByRole('status').filter({ hasText: 'Restart Better Charts' })).toBeVisible();

  await gear.click();
  await expect(dialog.getByLabel('Token', { exact: true })).toHaveValue('saved-token');
});

test('notification dismiss buttons hide independently and saving or reopening restores the notice', async ({
  page,
}) => {
  await gotoWithStub(page, {
    responses: {
      get_app_settings: {
        ...firstLaunch,
        mt5BridgeSettings: { ...firstLaunch.mt5BridgeSettings, token: 'demo-token' },
        firstLaunch: false,
        restartRequired: true,
        configurationError: 'Invalid environment configuration. Fix the override and restart.',
      },
    },
  });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  const restart = page.getByRole('status').filter({ hasText: 'Restart Better Charts' });
  const error = page.getByRole('alert');
  await restart.getByRole('button', { name: 'Dismiss settings saved notification' }).focus();
  await page.keyboard.press('Enter');
  await expect(restart).toBeHidden();
  await expect(error).toBeVisible();
  await error.getByRole('button', { name: 'Dismiss configuration notification' }).click();
  await expect(error).toBeHidden();
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(error).toBeVisible();
  await expect(restart).toBeHidden();
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(restart).toBeVisible();
  await expect(error).toBeVisible();
  await expect(error).toContainText('Invalid environment configuration');
});

test('notification enters and exits with fade and slide while dismissal waits for the exit', async ({ page }) => {
  await gotoWithStub(page, {
    responses: { get_app_settings: { ...firstLaunch, firstLaunch: false, restartRequired: true } },
  });
  const notice = page.getByRole('status').filter({ hasText: 'Restart Better Charts' });
  await expect(notice).toHaveCSS('animation-name', 'notification-in');
  await expect(notice).toHaveCSS('animation-duration', '0.18s');
  const dismiss = notice.getByRole('button', { name: 'Dismiss settings saved notification' });
  await dismiss.click();
  await expect(notice).toHaveClass(/is-closing/);
  await expect(notice).toHaveCSS('animation-name', 'notification-out');
  await expect(dismiss).toBeDisabled();
  await expect(notice).toBeHidden();
});

test('opening and closing Settings keeps existing notification elements and completed animations', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_app_settings: {
        ...firstLaunch,
        firstLaunch: false,
        restartRequired: true,
        configurationError: 'Invalid environment configuration. Fix the override and restart.',
      },
    },
  });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  const notices = page.locator('.notification');
  const originalElements = await notices.elementHandles();
  expect(originalElements).toHaveLength(2);
  for (const element of originalElements) {
    await element.evaluate(async (notice) => {
      await Promise.all((notice as Element).getAnimations().map((animation: Animation) => animation.finished));
    });
  }
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await expect(dialog).toBeVisible();
  for (const element of originalElements) {
    expect(await element.evaluate((notice) => notice.isConnected)).toBe(true);
    expect(await element.evaluate((notice) => (notice as Element).getAnimations().length)).toBe(0);
  }
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  for (const element of originalElements) {
    expect(await element.evaluate((notice) => notice.isConnected)).toBe(true);
  }
});

test('opening Settings lets an existing notification finish its dismissal', async ({ page }) => {
  await gotoWithStub(page, {
    responses: { get_app_settings: { ...firstLaunch, firstLaunch: false, restartRequired: true } },
  });
  const notice = page.getByRole('status').filter({ hasText: 'Restart Better Charts' });
  await expect(notice).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="Dismiss settings saved notification"]')!.click();
    document.querySelector<HTMLButtonElement>('[aria-label="App settings"]')!.click();
  });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await expect(dialog).toBeVisible();
  await expect(notice).toHaveClass(/is-closing/);
  await expect(notice).toBeHidden();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(notice).toBeHidden();
});

test('saving during a notification exit prevents the old dismissal from hiding the new reminder', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_app_settings: {
        ...firstLaunch,
        mt5BridgeSettings: { ...firstLaunch.mt5BridgeSettings, token: 'demo-token' },
        firstLaunch: false,
        restartRequired: true,
      },
    },
  });
  const notice = page.getByRole('status').filter({ hasText: 'Restart Better Charts' });
  await expect(notice).toBeVisible();
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="Dismiss settings saved notification"]')!.click();
    document.querySelector<HTMLButtonElement>('[aria-label="App settings"]')!.click();
  });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  // Submit before the old notification's 180ms exit has finished.
  await dialog
    .getByRole('button', { name: 'Save', exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(dialog).toBeHidden();
  await expect(notice).not.toHaveClass(/is-closing/);
  // Wait beyond the old exit deadline to ensure it cannot dismiss this notice.
  await page.waitForTimeout(220);
  await expect(notice).toBeVisible();
  await expect(notice.getByRole('button', { name: 'Dismiss settings saved notification' })).toBeEnabled();
});

test('notification reduced motion skips animation and removes immediately on dismiss', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoWithStub(page, {
    responses: { get_app_settings: { ...firstLaunch, firstLaunch: false, restartRequired: true } },
  });
  const notice = page.getByRole('status').filter({ hasText: 'Restart Better Charts' });
  await expect(notice).toHaveCSS('animation-name', 'none');
  await notice.getByRole('button', { name: 'Dismiss settings saved notification' }).click();
  await expect(notice).toHaveCount(0);
});

test('first launch opens connection setup, validates and saves all settings', async ({ page }) => {
  await gotoWithStub(page, { responses: { get_app_settings: firstLaunch } });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Welcome to Better Charts.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.notification-region [role=alert]').filter({ hasText: 'nonempty token' })).toBeVisible();
  await dialog.getByLabel('Token', { exact: true }).fill('private-demo-token');
  await expect(dialog.getByLabel('Token', { exact: true })).toHaveAttribute('type', 'password');
  await dialog.getByLabel('Show token').check();
  await expect(dialog.getByLabel('Token', { exact: true })).toHaveAttribute('type', 'text');
  await dialog.getByLabel('Address', { exact: true }).fill('0.0.0.0:8765');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.notification-region [role=alert]').filter({ hasText: 'local address' })).toBeVisible();
  await dialog.getByLabel('Address', { exact: true }).fill('127.0.0.2:8766');
  await dialog.getByLabel('Maximum frame bytes').fill('1023');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.notification-region [role=alert]').filter({ hasText: '1024' })).toBeVisible();
  await dialog.getByLabel('Maximum frame bytes').fill('4194304');
  await dialog.getByRole('button', { name: 'Trading', exact: true }).click();
  await dialog.getByLabel('Allow order execution').check();
  await dialog.getByRole('button', { name: 'MT5 setup', exact: true }).click();
  await expect(dialog.getByLabel('Start MT5 when Better Charts launches')).toBeVisible();
  await dialog.getByLabel('Start MT5 when Better Charts launches').check();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.notification-region [role=alert]').filter({ hasText: 'terminal path' })).toBeVisible();
  await dialog.getByLabel('MT5 executable path').fill('/opt/mt5/terminal64.exe');
  await dialog.getByLabel('Wine binary path').fill('/usr/bin/wine');
  await dialog.getByLabel('Wine prefix path').fill('/home/demo/.wine');
  await dialog.getByLabel('Startup configuration path').fill('/home/demo/mt5.ini');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectBannerTextUncovered(page.getByRole('status').filter({ hasText: 'Restart Better Charts' }));
  const pointerUncovered = await page
    .getByRole('button', { name: 'Pointer tools', exact: true })
    .evaluate((element) => {
      const box = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + 4);
      return topmost === element || (topmost !== null && element.contains(topmost));
    });
  expect(pointerUncovered).toBe(true);
  const saves = (await stubInvocations(page)).filter(({ cmd }) => cmd === 'save_app_settings');
  expect(saves).toHaveLength(1);
  expect(saves[0].args.settings).toMatchObject({
    address: '127.0.0.2:8766',
    maxFrameBytes: 4194304,
    tradingEnabled: true,
    autoStartMt5: true,
  });
  expect((await stubInvocations(page)).some(({ cmd }) => cmd === 'start_mt5_backend')).toBe(false);
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await expect(dialog.getByLabel('Token', { exact: true })).toHaveValue('private-demo-token');
  await expect(dialog.getByLabel('Address', { exact: true })).toHaveValue('127.0.0.2:8766');
  expect(await page.evaluate(() => Object.values(localStorage).join(' '))).not.toContain('private-demo-token');
});

test('gear opens layout, traps focus, ignores chart shortcuts and cancel keeps settings', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await gotoWithStub(page);
  await expect(page.getByRole('dialog', { name: 'App settings' })).toBeHidden();
  const gear = page.getByRole('button', { name: 'App settings', exact: true });
  await gear.click();
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close settings' })).toBeFocused();
  await expect.poll(async () => Math.round((await dialog.boundingBox())?.height ?? 0)).toBe(860);
  const initialBox = await dialog.boundingBox();
  expect(initialBox).not.toBeNull();
  expect(initialBox?.height).toBe(860);
  await page.setViewportSize({ width: 1280, height: 800 });
  expect((await dialog.boundingBox())?.height).toBe(776);
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  await page.setViewportSize({ width: 1280, height: 1000 });
  for (const category of ['Trading', 'MT5 setup']) {
    await dialog.getByRole('button', { name: category, exact: true }).click();
    const currentBox = await dialog.boundingBox();
    expect(currentBox?.height).toBe(initialBox?.height);
    expect(currentBox?.y).toBe(initialBox?.y);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'MT5 setup', exact: true }).click();
  await dialog.getByLabel('Startup configuration path').scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: 'MT5 setup', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close settings' }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close settings' })).toBeFocused();
  await dialog.getByLabel('Token', { exact: true }).fill('unsaved-token');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search symbols' })).toBeHidden();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(gear).toBeFocused();
  await gear.click();
  await expect(dialog.getByLabel('Token', { exact: true })).toHaveValue('demo-settings-token');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect((await stubInvocations(page)).filter(({ cmd }) => cmd === 'save_app_settings')).toHaveLength(0);
});

test('failed save stays open and preserves input', async ({ page }) => {
  await gotoWithStub(page, { failures: { save_app_settings: 'disk unavailable' } });
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await dialog.getByLabel('Token', { exact: true }).fill('keep-this-token');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.locator('.notification-region [role=alert]').filter({ hasText: 'Could not save settings' }),
  ).toBeVisible();
  await expect(dialog.getByLabel('Token', { exact: true })).toHaveValue('keep-this-token');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
});

test('Windows startup hides Wine fields and settings fit a small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await gotoWithStub(page, { responses: { get_app_settings: { ...firstLaunch, platform: 'windows' } } });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await dialog.getByRole('button', { name: 'MT5 setup', exact: true }).click();
  await expect(dialog.getByLabel('Wine binary path')).toHaveCount(0);
  await expect(dialog.getByLabel('MT5 executable path')).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  for (const category of ['Trading', 'MT5 setup']) {
    await dialog.getByRole('button', { name: category, exact: true }).click();
    expect((await dialog.boundingBox())?.height).toBe(box?.height);
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  }
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 480 });
    await dialog.getByRole('button', { name: 'MT5 setup', exact: true }).click();
    await dialog.getByLabel('Startup configuration path').scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'MT5 setup', exact: true })).toBeInViewport();
    expect((await dialog.boundingBox())?.height).toBeLessThanOrEqual(480);
  }
});

test('configuration errors open settings and remain visible after save', async ({ page }) => {
  await gotoWithStub(page, {
    responses: {
      get_app_settings: {
        ...firstLaunch,
        firstLaunch: false,
        configurationError: 'Invalid environment configuration. Fix the override and restart.',
      },
    },
  });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Token', { exact: true }).fill('valid-demo-token');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('Invalid environment configuration');
  await expectBannerTextUncovered(page.getByRole('alert'));
});

test('settings dismiss animation preserves focus and an interrupted exit can reopen', async ({ page }) => {
  await gotoWithStub(page);
  const gear = page.getByRole('button', { name: 'App settings', exact: true });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  await gear.click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator('.settings-backdrop')).toHaveClass(/is-closing/);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Tab');
  await expect(dialog).toBeFocused();
  await gear.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator('.settings-backdrop')).not.toHaveClass(/is-closing/);
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  // Allow the original exit deadline to pass; the reopened dialog must remain.
  await page.waitForTimeout(220);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(gear).toBeFocused();
});

test('settings respects reduced motion and repeated close/reopen stays usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoWithStub(page);
  const gear = page.getByRole('button', { name: 'App settings', exact: true });
  const dialog = page.getByRole('dialog', { name: 'App settings' });
  for (let iteration = 0; iteration < 2; iteration += 1) {
    await gear.click();
    await expect(dialog).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.settings-backdrop')).toHaveCSS('animation-name', 'none');
    await dialog.getByRole('button', { name: 'Close settings' }).click();
    await expect(dialog).toBeHidden();
    await expect(gear).toBeFocused();
  }
});
