import type { Page } from '@playwright/test';
import { openChart } from './openChart';
import { savedOverrides } from './savedOverrides';
import { chartScopeKey, gotoWithStub, stubChartSettingOverrides } from './tauriStub';

export const EURUSD_CHART = chartScopeKey('50123456@Broker-Demo', 'EURUSD');

/** The `indicators` value one overrides document holds, or undefined while it holds none. */
function indicatorsOf(overrides: unknown): unknown {
  if (typeof overrides !== 'object' || overrides === null) {
    return undefined;
  }
  return 'indicators' in overrides ? overrides['indicators'] : undefined;
}

/** Returns the raw `indicators` value of the most recently saved overrides object. */
export function latestSavedIndicators(page: Page): Promise<unknown> {
  return savedOverrides(page).then((saved) => indicatorsOf(saved.at(-1)));
}

/**
 * Returns the raw `indicators` value the backend holds for the seeded chart: the overrides document the app
 * saved, which a reload reads back and which only a change has to save again.
 */
export async function storedIndicators(page: Page): Promise<unknown> {
  const stored = await stubChartSettingOverrides(page);
  return indicatorsOf(stored[EURUSD_CHART]);
}

/**
 * Opens the app with the given raw indicator entries stored in the chart's overrides and waits for the
 * stub's bars, so that the chart has processed them.
 */
export async function openWithSavedIndicators(page: Page, indicators: unknown[]): Promise<void> {
  await gotoWithStub(page, { chartSettingOverrides: { [EURUSD_CHART]: { indicators } } });
  await openChart(page);
}
