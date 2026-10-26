import type { Page } from '@playwright/test';
import type { ToolInputValues } from '../../src/features/chart/engine/drawings/toolInputs';
import type { ToolSettingsSchema } from '../../src/features/chart/engine/drawings/toolSettings';
import { gotoWithStub } from './tauriStub';

/** Page-side steps shared by the drawing settings specs; the form itself is mounted by the harness module. */

/**
 * Loads the app page, then mounts the harness form, which replaces the page with the bare form. Without a
 * declaration the form holds one input of every kind; `overrides` replaces the starting draft.
 */
export async function mountSettingsForm(
  page: Page,
  settings?: ToolSettingsSchema,
  overrides: ToolInputValues = {},
): Promise<void> {
  await gotoWithStub(page);
  await page.evaluate(
    async ({ declared, initialValues }) => {
      const harnessPath = '/e2e/helpers/drawingSettingsHarness.tsx';
      const harness = await import(/* @vite-ignore */ harnessPath);
      harness.mountSettingsFormHarness(declared, initialValues);
    },
    { declared: settings, initialValues: overrides },
  );
}

/** Every draft the form saved, oldest first. */
export async function savedValues(page: Page): Promise<ToolInputValues[]> {
  return page.evaluate(
    () => (window as unknown as { __drawingSettings: { saves: ToolInputValues[] } }).__drawingSettings.saves,
  );
}
