import type { Page } from '@playwright/test';

/** Whether the chart currently paints a staged order (DEV hook window.__stagedWidgetTest). */
export async function stagedState(page: Page): Promise<boolean | undefined> {
  return page.evaluate(() => {
    const api = (window as unknown as { __stagedWidgetTest?: { geometry(): { staged: boolean } | null } })
      .__stagedWidgetTest;
    return api?.geometry()?.staged;
  });
}
