import type { Page } from '@playwright/test';
import { openChart } from './openChart';
import { chartScopeKey, gotoWithStub } from './tauriStub';

export const EURUSD_CHART = chartScopeKey('50123456@Broker-Demo', 'EURUSD');

/**
 * Opens the app with the given raw indicator entries stored in the chart's overrides and waits for the
 * stub's bars, so that the chart has processed them.
 */
export async function openWithSavedIndicators(page: Page, indicators: unknown[]): Promise<void> {
  await gotoWithStub(page, { chartSettingOverrides: { [EURUSD_CHART]: { indicators } } });
  await openChart(page);
}
