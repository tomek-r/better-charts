import { expect, type Locator, type Page } from '@playwright/test';
import type {
  Mt5DataFolderView,
  Mt5InstallationView,
  Mt5InstallOutcome,
  Mt5InstallReport,
} from '../../src/shared/bridge/types';

/** Host `MQL5` folder of the stub's default portable installation. */
export const PORTABLE_MQL5_PATH = '/mt5/drive_c/Program Files/MetaTrader 5/MQL5';

/** Windows terminal path of the stub's default installation. */
export const DEFAULT_TERMINAL_PATH = 'C:\\Program Files\\MetaTrader 5\\terminal64.exe';

/** A `standard` data folder, as a second MT5 data folder of the same installation. */
export const STANDARD_MQL5_PATH = '/mt5/drive_c/users/demo/AppData/Roaming/MetaQuotes/Terminal/9F2E1A/MQL5';

/** The two folders one installation can offer, so a test can watch the folder select. */
export const TWO_DATA_FOLDERS: Mt5DataFolderView[] = [
  { mql5Path: PORTABLE_MQL5_PATH, layout: 'portable', expertAdvisorInstalled: true },
  { mql5Path: STANDARD_MQL5_PATH, layout: 'standard', expertAdvisorInstalled: true },
];

/** One MT5 installation as `list_mt5_installations` reports it; `overrides` changes only what a test cares about. */
export function mt5Installation(overrides: Partial<Mt5InstallationView> = {}): Mt5InstallationView {
  return {
    terminalPath: DEFAULT_TERMINAL_PATH,
    label: 'MetaTrader 5',
    configured: false,
    dataFolders: [{ mql5Path: PORTABLE_MQL5_PATH, layout: 'portable', expertAdvisorInstalled: true }],
    ...overrides,
  };
}

/**
 * A clean `install_to_mt5` report: both bundled files compiled without a diagnostic,
 * with the outcomes the test cares about.
 */
export function cleanInstallReport(
  expertAdvisor: Mt5InstallOutcome,
  indicator: Mt5InstallOutcome = expertAdvisor,
): Mt5InstallReport {
  return {
    files: [
      {
        file: 'indicator',
        path: `${PORTABLE_MQL5_PATH}/Indicators/BetterChartsTickHistoryReader.mq5`,
        outcome: indicator,
        compiled: { errors: 0, warnings: 0, messages: [] },
      },
      {
        file: 'expertAdvisor',
        path: `${PORTABLE_MQL5_PATH}/Experts/BetterChartsBridge.mq5`,
        outcome: expertAdvisor,
        compiled: { errors: 0, warnings: 0, messages: [] },
      },
    ],
  };
}

/** The target an `install_to_mt5` or a `restart_mt5_with_ea` request named, as the stub recorded it. */
export interface Mt5InstallRequest {
  terminalPath: string;
  mql5Path: string;
}

/** Every request one setup-guide command recorded on its page global, oldest first. */
async function recordedTargets(page: Page, key: '__mt5Installs' | '__mt5Restarts'): Promise<Mt5InstallRequest[]> {
  return page.evaluate(
    (name) => (window as unknown as Record<string, Mt5InstallRequest[] | undefined>)[name] ?? [],
    key,
  );
}

/** Every `install_to_mt5` request the stub recorded, oldest first. */
export async function mt5InstallRequests(page: Page): Promise<Mt5InstallRequest[]> {
  return recordedTargets(page, '__mt5Installs');
}

/** Every `restart_mt5_with_ea` request the stub recorded, oldest first. */
export async function mt5RestartRequests(page: Page): Promise<Mt5InstallRequest[]> {
  return recordedTargets(page, '__mt5Restarts');
}

/** The guide's step indicator items, in order. */
export function guideSteps(guide: Locator): Locator {
  return guide.locator('.setup-guide-progress li');
}

/** The step the guide currently marks as the one on screen. */
export function currentGuideStep(guide: Locator): Locator {
  return guide.locator('.setup-guide-progress li[aria-current="step"]');
}

/** Opens App settings and the setup guide nested inside it, returning the guide dialog. */
export async function openSetupGuide(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'App settings', exact: true }).click();
  await page.getByRole('button', { name: 'How to set up the bridge connection' }).click();
  const guide = page.getByRole('dialog', { name: 'Set up the MT5 bridge' });
  await expect(guide).toBeVisible();
  return guide;
}

/** Opens the guide and moves on to its Install step, returning the guide dialog. */
export async function openInstallStep(page: Page): Promise<Locator> {
  const guide = await openSetupGuide(page);
  await guide.getByRole('button', { name: 'Next' }).click();
  await expect(guide.getByRole('heading', { name: 'Install', exact: true })).toBeVisible();
  return guide;
}

/** Opens the guide and moves on to its Connect step, returning the guide dialog. */
export async function openConnectStep(page: Page): Promise<Locator> {
  const guide = await openInstallStep(page);
  await guide.getByRole('button', { name: 'Install only' }).click();
  await expect(guide.getByRole('heading', { name: 'Connect', exact: true })).toBeVisible();
  return guide;
}

/** The options the guide's native file picker opened with. */
export interface PickerOptions {
  defaultPath?: string;
  multiple?: boolean;
  directory?: boolean;
  filters?: { name: string; extensions: string[] }[];
}

/** Scripts the terminal `terminal64.exe` the native file picker returns; `null` is the user cancelling. */
export async function scriptPickedTerminal(page: Page, path: string | null): Promise<void> {
  await page.evaluate((picked) => {
    (window as unknown as { __pickerPath?: string | null }).__pickerPath = picked;
  }, path);
}

/** The options the native file picker was last opened with, or undefined when it never opened. */
export async function pickerOptions(page: Page): Promise<PickerOptions | undefined> {
  return page.evaluate(() => (window as unknown as { __pickerOptions?: PickerOptions }).__pickerOptions);
}

/** Every `terminal64.exe` path a `choose_mt5_installation` call named, oldest first. */
export async function mt5Choices(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __mt5Choices?: string[] }).__mt5Choices ?? []);
}

/** The localStorage key the app stores a finished setup under. */
export const SETUP_COMPLETED_KEY = 'better-charts.setup-completed';

/** Marks the setup completed for this context, as "Happy trading" does, so later loads skip it. */
export async function markSetupCompleted(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, 'true');
  }, SETUP_COMPLETED_KEY);
}
