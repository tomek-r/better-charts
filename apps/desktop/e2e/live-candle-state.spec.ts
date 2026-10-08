import { expect, test } from '@playwright/test';
import { gotoWithStub, pushEvent, STUB_NOW } from './tauriStub';

for (const empty of [false, true]) {
  test(`live raw tail preserves history and staged fallback (${empty ? 'empty' : 'loaded'} history)`, async ({
    page,
  }) => {
    await gotoWithStub(page, {
      responses: {
        get_quote_snapshot: null,
        request_history: null,
        ...(empty ? { get_market_snapshot: { symbol: 'EURUSD', timeframe: 'M5', complete: true, candles: [] } } : {}),
      },
    });
    await page.evaluate(async () => {
      document.getElementById('root')!.style.display = 'none';
      const path = '/e2e/liveCandleHarness.tsx';
      const { mountLiveCandleHarness } = await import(/* @vite-ignore */ path);
      const container = document.createElement('div');
      container.style.height = '600px';
      document.body.append(container);
      mountLiveCandleHarness(container);
    });
    const read = () =>
      page.evaluate(() =>
        (
          window as unknown as {
            __readLiveProbe: () => {
              historyStable: boolean;
              historyLength: number;
              latest?: { close: string };
              currentPrice?: number;
            };
          }
        ).__readLiveProbe(),
      );
    await expect
      .poll(() =>
        page.evaluate(() => typeof (window as unknown as { __readLiveProbe?: unknown }).__readLiveProbe === 'function'),
      )
      .toBe(true);
    await expect.poll(async () => (await read()).historyStable).toBe(true);
    const candle = {
      timeMs: STUB_NOW,
      open: '1.085000000',
      high: '1.116000000',
      low: '1.084000000',
      close: '1.115432100',
      tickVolume: 12,
      spread: 2,
      realVolume: 0,
    };
    await pushEvent(page, 'bar-update', { symbol: 'EURUSD', timeframe: 'M5', candle });
    await expect(page.getByTestId('live-close')).toHaveText(candle.close);
    expect(await read()).toMatchObject({ historyStable: true, historyLength: empty ? 0 : 10, latest: candle });
    await page.getByRole('button', { name: 'Stage live fallback' }).click();
    await expect(page.getByTestId('live-entry')).toHaveText('1.12');
    await pushEvent(page, 'bar-update', {
      symbol: 'EURUSD',
      timeframe: 'M5',
      candle: { ...candle, close: '1.115678900' },
    });
    await expect(page.getByTestId('live-close')).toHaveText('1.115678900');
    await expect.poll(async () => (await read()).currentPrice).toBe(1.1156789);
    expect((await read()).historyStable).toBe(true);
  });
}
