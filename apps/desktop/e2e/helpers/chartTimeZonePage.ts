import { expect, type Locator, type Page } from '@playwright/test';
import { chartScopeKey, STUB_CHART_ID, stubChartSettingOverrides, stubInvocations } from './tauriStub';

/**
 * Page-side steps shared by the specs that read a chart's stored settings: the footer clock that shows
 * the chart's zone and opens the menu which picks it, the label a chart drawn in UTC shows there, and
 * the overrides the app stores when a zone is chosen.
 */

/** The account the stub's bridge status and account snapshot both report. */
const ACCOUNT_KEY = '50123456@Broker-Demo';
/** One chart is one account and one symbol, which is how the backend keys its settings. */
const EURUSD_CHART = chartScopeKey(ACCOUNT_KEY, 'EURUSD');

/** The clock label of a chart whose bars are drawn in UTC. */
export const UTC_CLOCK = /^\d{2}:\d{2}:\d{2} UTC$/;

/** The footer clock under the chart, which shows the chart's zone and opens the menu that picks it. */
export function timeZoneButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Time zone', exact: true });
}

/** The last arguments the app stored overrides with, or undefined while it stored none. */
export async function lastSavedOverridesArgs(page: Page): Promise<Record<string, unknown> | undefined> {
  const saves = (await stubInvocations(page)).filter((entry) => entry.cmd === 'save_chart_setting_overrides');
  return saves.at(-1)?.args;
}

/** Waits for the UTC override stored against this chart, then checks what the app was asked to store. */
export async function expectUtcZoneSaved(page: Page): Promise<void> {
  await expect.poll(() => stubChartSettingOverrides(page)).toEqual({ [EURUSD_CHART]: { timeZone: 'UTC' } });
  expect(await lastSavedOverridesArgs(page)).toEqual({
    chartId: STUB_CHART_ID,
    accountKey: ACCOUNT_KEY,
    symbol: 'EURUSD',
    overrides: { timeZone: 'UTC' },
  });
}
