import { expect, test } from '@playwright/test';
import { gotoWithStub } from './tauriStub';

test('coalesces same-turn history selections and suppresses requests invalidated before dispatch', async ({ page }) => {
  await gotoWithStub(page);
  const result = await page.evaluate(async () => {
    const adapterPath = '/src/features/chart/engine/mt5DataAdapter.ts';
    const { Mt5DataAdapter } = await import(/* @vite-ignore */ adapterPath);
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const calls: Array<{ command: string; args?: Record<string, unknown> }> = [];
    internals.invoke = async (command, args) => {
      calls.push({ command, args });
      return undefined;
    };

    const selections = new Mt5DataAdapter();
    const sequence = [
      selections.requestHistory('AUDUSD', 'M1', 10),
      selections.requestHistory('EURUSD', 'M1', 20),
      selections.requestHistory('AUDUSD', 'M1', 30),
    ];
    await Promise.all(sequence);
    const coalescedCalls = calls.splice(0);
    selections.resetRequests();

    const duplicate = new Mt5DataAdapter();
    await Promise.all([duplicate.requestHistory('USDJPY', 'M5', 40), duplicate.requestHistory('USDJPY', 'M5', 50)]);
    const duplicateCalls = calls.splice(0);
    duplicate.resetRequests();

    const resetBeforeDispatch = new Mt5DataAdapter();
    const resetRequest = resetBeforeDispatch.requestHistory('GBPUSD', 'M15');
    resetBeforeDispatch.resetRequests();
    await resetRequest;
    const resetCalls = calls.splice(0);

    const disposeBeforeDispatch = new Mt5DataAdapter();
    const disposeRequest = disposeBeforeDispatch.requestHistory('USDCAD', 'H1');
    disposeBeforeDispatch.dispose();
    await disposeRequest;
    const disposeCalls = calls.splice(0);

    selections.dispose();
    duplicate.dispose();
    return { coalescedCalls, duplicateCalls, resetCalls, disposeCalls };
  });

  expect(result.coalescedCalls).toEqual([
    { command: 'request_history', args: { symbol: 'AUDUSD', timeframe: 'M1', bars: 30 } },
  ]);
  expect(result.duplicateCalls).toEqual([
    { command: 'request_history', args: { symbol: 'USDJPY', timeframe: 'M5', bars: 40 } },
  ]);
  expect(result.resetCalls).toEqual([]);
  expect(result.disposeCalls).toEqual([]);
});
