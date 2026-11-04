import type { Page } from '@playwright/test';
import { stubInvocations } from './tauriStub';

/** The overrides every `save_chart_setting_overrides` call carried, oldest first. */
export async function savedOverrides(page: Page): Promise<unknown[]> {
  const calls = (await stubInvocations(page)).filter((entry) => entry.cmd === 'save_chart_setting_overrides');
  return calls.map((entry) => entry.args.overrides);
}
