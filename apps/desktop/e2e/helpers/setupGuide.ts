import { expect, type Locator, type Page } from '@playwright/test';
import type { Mt5InstallationView } from '../../src/shared/bridge/types';

/** Host `MQL5` folder of the stub's default portable installation. */
export const PORTABLE_MQL5_PATH = '/mt5/drive_c/Program Files/MetaTrader 5/MQL5';

/** Windows terminal path of the stub's default installation. */
export const DEFAULT_TERMINAL_PATH = 'C:\\Program Files\\MetaTrader 5\\terminal64.exe';

/** A `standard` data folder, as a second MT5 data folder of the same installation. */
export const STANDARD_MQL5_PATH = '/mt5/drive_c/users/demo/AppData/Roaming/MetaQuotes/Terminal/9F2E1A/MQL5';

/** One MT5 installation as `list_mt5_installations` reports it; `overrides` changes only what a test cares about. */
export function mt5Installation(overrides: Partial<Mt5InstallationView> = {}): Mt5InstallationView {
  return {
    terminalPath: DEFAULT_TERMINAL_PATH,
    label: 'MetaTrader 5',
    configured: false,
    dataFolders: [{ mql5Path: PORTABLE_MQL5_PATH, layout: 'portable' }],
    ...overrides,
  };
}

/** The target an `install_to_mt5` request named, as the stub recorded it. */
export interface Mt5InstallRequest {
  terminalPath: string;
  mql5Path: string;
}

/** Every `install_to_mt5` request the stub recorded, oldest first. */
export async function mt5InstallRequests(page: Page): Promise<Mt5InstallRequest[]> {
  return page.evaluate(() => (window as unknown as { __mt5Installs?: Mt5InstallRequest[] }).__mt5Installs ?? []);
}

/** Opens App settings and the setup guide nested inside it, returning the guide dialog. */
export async function openSetupGuide(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('button', { name: 'How to set up the bridge connection' }).click();
  const guide = page.getByRole('dialog', { name: 'Set up the MT5 bridge' });
  await expect(guide).toBeVisible();
  return guide;
}
