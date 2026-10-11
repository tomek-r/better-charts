import { expect, test } from '@playwright/test';
import { describeRejection } from '../src/features/execution/tradeRejection';
import { expectNoErrors, gotoWithStub, pushCommandUpdate } from './helpers/tauriStub';

// Pure-module coverage: the single place that turns a rejected update into text.
test('known retcodes append an actionable hint to the EA message', () => {
  expect(describeRejection({ retcode: 10016, message: 'Modify SL/TP rejected: Invalid stops (10016)' })).toBe(
    "Modify SL/TP rejected: Invalid stops (10016) SL/TP is too close to the current price or on the wrong side. Move it further away (the broker's minimum distance applies).",
  );
  expect(describeRejection({ retcode: 10027, message: 'Rejected' })).toBe(
    'Rejected Enable Algo Trading in MetaTrader 5.',
  );
  expect(describeRejection({ retcode: 10029, message: 'x' })).toContain('freeze level');
});

test('unknown retcodes show the EA message only', () => {
  expect(describeRejection({ retcode: 10099, message: 'Broker said no' })).toBe('Broker said no');
});

test('a missing message falls back to the code, with a hint when one exists', () => {
  expect(describeRejection({ retcode: 10099, message: null })).toBe('Order rejected by MT5 (code 10099).');
  expect(describeRejection({ retcode: null, message: '  ' })).toBe('Order rejected by MT5 (code unknown).');
  expect(describeRejection({ retcode: 10018, message: undefined })).toBe(
    'Order rejected by MT5 (code 10018). The market is closed.',
  );
});

test('a legacy EA (retcode -1, fixed message) is shown exactly as before', () => {
  expect(describeRejection({ retcode: -1, message: 'PositionModify failed' })).toBe('PositionModify failed');
});

test('a rejected update with retcode 10016 shows the hint in the error notification', async ({ page }) => {
  const errors = await gotoWithStub(page);
  await pushCommandUpdate(page, {
    status: 'rejected',
    retcode: 10016,
    message: 'Modify SL/TP rejected: Invalid stops (10016)',
  });
  const notice = page.locator('.notification-region [role=alert]');
  await expect(notice).toContainText('Invalid stops (10016)');
  await expect(notice).toContainText('Move it further away');
  expectNoErrors(errors);
});
