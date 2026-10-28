import type { Page } from '@playwright/test';
import { openTradePanel } from './panel';
import { gotoWithStub, openPositionFixture, STUB_NOW } from './tauriStub';

/** A `portfolio-snapshot` payload whose positions allow partial close (min 0.01, step 0.01). */
export function portfolioSnapshot(positions: Record<string, unknown>[]) {
  return {
    accountLogin: '50123456',
    capturedAtMs: STUB_NOW,
    positions: positions.map((position) =>
      openPositionFixture({ volume_min: '0.01', volume_step: '0.01', ...position }),
    ),
    orders: [],
  };
}

export async function openPortfolio(
  page: Page,
  position: Record<string, unknown> = {},
  options: {
    partialClose?: boolean;
    failures?: Record<string, string>;
    morePositions?: Record<string, unknown>[];
  } = {},
) {
  await gotoWithStub(page, {
    partialClose: options.partialClose ?? true,
    failures: options.failures,
    responses: { get_portfolio_snapshot: portfolioSnapshot([position, ...(options.morePositions ?? [])]) },
  });
  await openTradePanel(page);
  const row = page.locator('.portfolio-row');
  return {
    row,
    mainClose: row.getByRole('button', { name: 'Close', exact: true }),
    menuButton: row.getByLabel('Close part of position'),
  };
}
