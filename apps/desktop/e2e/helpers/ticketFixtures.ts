import { brokerSymbolFixture } from './tauriStub';
import type { TicketDerivationInput } from '../../src/features/order-ticket/derivation/deriveOrderTicket';
import type { AccountSnapshot, BrokerSymbol, OrderCheckResult } from '../../src/shared/bridge/types';

export const ticketAccount: AccountSnapshot = {
  accountLogin: '123456',
  brokerServer: 'Demo-Server',
  currency: 'USD',
  balance: '10000.00',
  equity: '10000.00',
  margin: '0.00',
  freeMargin: '10000.00',
  marginLevel: '0.00',
  leverage: 100,
  marginMode: 2,
  tradeAllowed: true,
  expertAllowed: true,
};

export const ticketInstrument: BrokerSymbol = brokerSymbolFixture('TEST', 'Test instrument', {
  digits: 2,
  tickSize: '0.01',
  pointSize: '0.01',
  contractSize: '1',
  tickValueProfit: undefined,
  tickValueLoss: undefined,
  tickValueCurrency: undefined,
});

export const acceptedOrderCheck: OrderCheckResult = {
  draftVersion: 3,
  draftId: 'draft-1',
  accountLogin: ticketAccount.accountLogin,
  brokerServer: ticketAccount.brokerServer,
  symbol: 'TEST',
  side: 'buy',
  orderKind: 'market',
  volume: '0.10',
  requestedEntry: '100.00',
  checkPrice: '100.00',
  stopLoss: null,
  takeProfit: null,
  timeInForce: undefined,
  limitPrice: null,
  checkPassed: true,
  retcode: 0,
  lastError: 0,
  balance: '10000.00',
  equity: '10000.00',
  profit: '0.00',
  margin: '0.00',
  freeMargin: '10000.00',
  marginLevel: '0.00',
  comment: '',
  checkedAtMs: 1,
};

/** A ticket that is fully eligible to check and submit; scenarios override single fields. */
export const eligibleTicket: TicketDerivationInput = {
  symbol: 'TEST',
  bridgeState: 'connected',
  account: ticketAccount,
  stagedOnChart: true,
  riskSide: 'buy',
  entry: '100',
  stopLoss: '99',
  takeProfit: '',
  slOn: false,
  tpOn: false,
  orderKind: 'market',
  limitPrice: '',
  timeInForce: 'gtc',
  unitsMode: 'units',
  orderVolume: '0.10',
  orderCheck: acceptedOrderCheck,
  riskPreview: undefined,
  draftVersion: 3,
  riskLoading: false,
  instrument: ticketInstrument,
  quote: undefined,
  marketOpen: true,
};

/** The eligible ticket with field overrides; `check: null` removes the OrderCheck, an object overrides its fields. */
export function ticketScenario(
  input: Partial<TicketDerivationInput> | undefined,
  check: Partial<OrderCheckResult> | null | undefined,
): TicketDerivationInput {
  return {
    ...eligibleTicket,
    ...input,
    orderCheck: check === null ? undefined : { ...acceptedOrderCheck, ...check },
  };
}
