import { expect, test, type Page } from '@playwright/test';
import { gotoWithStub, stubInvocations } from './tauriStub';
import { SubscriptionScope } from '../src/shared/bridge/subscriptionScope';

async function listenerCount(page: Page, event: string) {
  return page.evaluate(
    (name) =>
      (
        window as unknown as { __E2E_TAURI_STUB__: { listenerCount: (event: string) => number } }
      ).__E2E_TAURI_STUB__.listenerCount(name),
    event,
  );
}

test('disposing during registration releases both current and late subscriptions once', async () => {
  const scope = new SubscriptionScope();
  let releases = 0;
  let complete!: (cleanup: () => void) => void;
  const late = new Promise<() => void>((resolve) => {
    complete = resolve;
  });
  const ready = scope.register([
    Promise.resolve(() => {
      releases += 1;
    }),
    late,
  ]);
  await Promise.resolve();
  scope.dispose();
  expect(releases).toBe(1);
  complete(() => {
    releases += 1;
  });
  await ready;
  scope.dispose();
  expect(releases).toBe(2);
});

for (const [failed, successful] of [
  ['quote-update', 'market-snapshot'],
  ['execution-command-error', 'execution-command-update'],
]) {
  test(`failed ${failed} registration releases successful subscriptions`, async ({ page }) => {
    await gotoWithStub(page, { listenerFailures: [failed] });
    await expect
      .poll(async () =>
        (await stubInvocations(page)).filter(
          (call) => call.cmd === 'plugin:event|listen' && call.args.event === failed,
        ),
      )
      .not.toHaveLength(0);
    await expect.poll(() => listenerCount(page, successful)).toBe(0);
  });
}
