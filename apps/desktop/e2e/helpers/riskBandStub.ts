import type { Page } from '@playwright/test';
import { brokerSymbolFixture, gotoWithStub } from './tauriStub';

// Balance 125 USD x 5% = 6.25 USD of risk. With 0.6 USD per 0.00001 tick per lot
// the minimum 0.1 lot spends it all at 104 ticks (0.00104) from the entry.
// The stub quote is bid 1.0846 / ask 1.0850.
export const riskBandInstrument = brokerSymbolFixture('EURUSD', 'Euro vs US Dollar', {
  digits: 5,
  tickSize: '0.00001',
  pointSize: '0.00001',
  tickValueProfit: '0.6',
  tickValueLoss: '0.6',
  volumeMin: '0.1',
  volumeMax: '100',
  volumeStep: '0.1',
});

/** Loads the app with the risk-band instrument and a 125 USD demo account. */
export function gotoRiskBandStub(page: Page) {
  return gotoWithStub(page, {
    symbolInfo: riskBandInstrument,
    responses: {
      // The reactive stub answers every request with a fixed 12.50 USD; specs push a realistic preview instead.
      request_risk_preview: null,
      get_account_snapshot: {
        accountLogin: '50123456',
        brokerServer: 'Broker-Demo',
        accountTradeMode: 0,
        accountTradeModeName: 'demo',
        currency: 'USD',
        currencyDigits: 2,
        balance: '125.00',
        equity: '125.00',
        margin: '0.00',
        freeMargin: '125.00',
        marginLevel: '0.00',
        leverage: 100,
        marginMode: 2,
        tradeAllowed: true,
        expertAllowed: true,
      },
    },
  });
}
