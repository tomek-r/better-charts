import { STUB_NOW } from './tauriStub';
import type { PortfolioSnapshot } from '../../src/shared/bridge/types';

/** One EURUSD buy position with SL and TP plus one pending sell limit: every chart trading line and chip. */
export const tradingPortfolio: PortfolioSnapshot = {
  accountLogin: '50123456',
  capturedAtMs: STUB_NOW,
  positions: [
    {
      ticket: '1001',
      positionId: '885001',
      symbol: 'EURUSD',
      timeMs: STUB_NOW,
      magic: '0',
      side: 'buy',
      volume: '0.10',
      priceOpen: '1.0850',
      priceCurrent: '1.0852',
      profit: '1.20',
      swap: '0.00',
      stopLoss: '1.0840',
      takeProfit: '1.0860',
    },
  ],
  orders: [
    {
      orderId: '990001',
      symbol: 'EURUSD',
      timeSetupMs: STUB_NOW,
      magic: '0',
      orderType: 'sell_limit',
      state: 'placed',
      volumeInitial: '0.20',
      volumeCurrent: '0.20',
      priceOpen: '1.0855',
      priceCurrent: '1.0855',
      stopLoss: null,
      takeProfit: null,
    },
  ],
};
