import { test, expect } from '@playwright/test';
import { deriveOrderTicket, type TicketDerivationInput } from '../src/features/order-ticket/domain/ticketRules';
import { createOrderTicketStores } from '../src/features/order-ticket/state/orderTicketStores';
import type { AccountSnapshot, BrokerSymbol, OrderCheckResult, RiskPreview } from '../src/shared/bridge/types';

const account: AccountSnapshot = {
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

const instrument: BrokerSymbol = {
  symbol: 'TEST',
  description: 'Test instrument',
  digits: 2,
  tickSize: '0.01',
  pointSize: '0.01',
  contractSize: '1',
  volumeMin: '0.01',
  volumeMax: '100',
  volumeStep: '0.01',
  stopsLevel: 0,
  freezeLevel: 0,
  fillingMode: 0,
  orderMode: 0,
  expirationMode: 0,
  tradeExecution: 0,
  tradeMode: 0,
};

const acceptedCheck: OrderCheckResult = {
  draftVersion: 3,
  draftId: 'draft-1',
  accountLogin: account.accountLogin,
  brokerServer: account.brokerServer,
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

const currentPreview: RiskPreview = {
  symbol: 'TEST',
  side: 'buy',
  draftVersion: 3,
  entry: '100',
  stopLoss: '99',
  takeProfit: null,
  riskBudget: '10.00',
  volume: '0.50',
  estimatedRisk: '10.00',
  estimatedReward: null,
  estimatedMargin: '0.00',
  rr: null,
  currency: 'USD',
  quotedAtMs: 1,
};

const eligibleTicket: TicketDerivationInput = {
  symbol: 'TEST',
  bridgeState: 'connected',
  account,
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
  orderCheck: acceptedCheck,
  riskPreview: undefined,
  draftVersion: 3,
  riskLoading: false,
  instrument,
  quote: undefined,
  marketOpen: true,
};

type PolicyCase = {
  name: string;
  input?: Partial<TicketDerivationInput>;
  check?: Partial<OrderCheckResult> | null;
  canCheckOrder: boolean;
  canSubmitOrder: boolean;
  blockedReason: string | undefined;
};

const cases: PolicyCase[] = [
  {
    name: 'an accepted current check allows review and submission; numeric price echoes are equivalent',
    canCheckOrder: true,
    canSubmitOrder: true,
    blockedReason: undefined,
  },
  {
    name: 'check requires a truthy symbol while submit preserves exact empty-symbol echo behavior',
    input: { symbol: '' },
    check: { symbol: '' },
    canCheckOrder: false,
    canSubmitOrder: true,
    blockedReason: undefined,
  },
  {
    name: 'bridge reason wins over account, market, stage, and volume failures',
    input: {
      bridgeState: 'disconnected',
      account: undefined,
      marketOpen: false,
      stagedOnChart: false,
      orderVolume: '',
    },
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: 'Bridge not connected.',
  },
  {
    name: 'account reason wins over market and stage failures',
    input: { account: undefined, marketOpen: false, stagedOnChart: false },
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: 'Account snapshot unavailable.',
  },
  {
    name: 'market reason wins over stage and volume failures',
    input: { marketOpen: false, stagedOnChart: false, orderVolume: '' },
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: 'Market is closed for this symbol — trading resumes when the session opens.',
  },
  {
    name: 'market-closed state blocks submit but does not block OrderCheck',
    input: { marketOpen: false },
    canCheckOrder: true,
    canSubmitOrder: false,
    blockedReason: 'Market is closed for this symbol — trading resumes when the session opens.',
  },
  {
    name: 'stage reason wins over volume failures',
    input: { stagedOnChart: false, orderVolume: '' },
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: 'Staged order was cleared from the chart — stage it again to send.',
  },
  {
    name: 'volume reason wins over stop distance and allocation failures',
    input: { orderVolume: '', slOn: true, stopLoss: '100', unitsMode: 'money', equityAllocationPercent: '0' },
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: 'Volume is required.',
  },
  {
    name: 'stop distance wins over allocation failure',
    input: { slOn: true, stopLoss: '100', unitsMode: 'money', equityAllocationPercent: '0' },
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: 'stop_loss too close: distance 0 pts, required >= 20 pts (20 ticks margin)',
  },
  {
    name: 'allocation failure wins over missing stop sizing',
    input: { unitsMode: 'money', equityAllocationPercent: '0' },
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: 'Equity allocation must be greater than 0 and at most 100%.',
  },
  {
    name: 'missing stop sizing wins over invalid stop-limit price',
    input: { unitsMode: 'money', orderKind: 'stop_limit', limitPrice: '' },
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: 'Money/% sizing needs a stop distance — enable Stop loss or switch to Units mode.',
  },
  {
    name: 'invalid limit price wins over a missing accepted check',
    input: { orderKind: 'stop_limit', limitPrice: '' },
    check: null,
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: 'Stop limit requires limit price — enter the resting limit price on the ticket.',
  },
  {
    name: 'stale accepted check reason wins over missing required preview',
    input: { slOn: true, unitsMode: 'money', riskPreview: undefined },
    check: { draftVersion: 2 },
    canCheckOrder: true,
    canSubmitOrder: false,
    blockedReason: 'Run OrderCheck in MT5 — an accepted result for the current draft is required.',
  },
  {
    name: 'market review tolerates preview refetch while submit reports an empty blocked reason',
    input: { slOn: true, unitsMode: 'money', riskPreview: undefined },
    canCheckOrder: true,
    canSubmitOrder: false,
    blockedReason: '',
  },
  {
    name: 'pending review also waits for preview freshness and preserves its empty reason',
    input: { slOn: true, unitsMode: 'money', orderKind: 'limit', riskPreview: undefined },
    check: { orderKind: 'limit' },
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: '',
  },
  {
    name: 'required preview with current draft, symbol, and side allows submit',
    input: { slOn: true, unitsMode: 'money', riskPreview: currentPreview },
    check: { stopLoss: '99.00' },
    canCheckOrder: true,
    canSubmitOrder: true,
    blockedReason: undefined,
  },
  {
    name: 'preview from an older draft remains stale even when the OrderCheck is current',
    input: { slOn: true, unitsMode: 'money', riskPreview: { ...currentPreview, draftVersion: 2 } },
    check: { stopLoss: '99.00' },
    canCheckOrder: true,
    canSubmitOrder: false,
    blockedReason: '',
  },
  {
    name: 'volume echo requires exact string equality even when numeric values match',
    check: { volume: '0.1' },
    canCheckOrder: true,
    canSubmitOrder: false,
    blockedReason: 'Volume changed — run OrderCheck in MT5 again.',
  },
  {
    name: 'enabled empty TP is optional and accepts a nullish echo',
    input: { tpOn: true, takeProfit: '' },
    check: { takeProfit: undefined },
    canCheckOrder: true,
    canSubmitOrder: true,
    blockedReason: undefined,
  },
  {
    name: 'bad entry is reported before an invalid nonempty TP',
    input: { entry: '1e2', tpOn: true, takeProfit: 'oops' },
    canCheckOrder: false,
    canSubmitOrder: false,
    blockedReason: 'Entry and stop loss must be valid prices.',
  },
  {
    name: 'invalid nonempty enabled TP gets its own reason',
    input: { tpOn: true, takeProfit: 'oops' },
    canCheckOrder: true,
    canSubmitOrder: false,
    blockedReason: 'Take profit must be a valid price or empty.',
  },
  {
    name: 'current check account echo mismatch falls through to generic reason',
    check: { accountLogin: '654321' },
    canCheckOrder: true,
    canSubmitOrder: false,
    blockedReason: 'Order panel is not ready.',
  },
  {
    name: 'current check broker echo mismatch falls through to generic reason',
    check: { brokerServer: 'Other-Server' },
    canCheckOrder: true,
    canSubmitOrder: false,
    blockedReason: 'Order panel is not ready.',
  },
  {
    name: 'absent time-in-force echo defaults to gtc',
    check: { timeInForce: null },
    canCheckOrder: true,
    canSubmitOrder: true,
    blockedReason: undefined,
  },
  {
    name: 'stop-limit price echoes use numeric comparison',
    input: { entry: '105', orderKind: 'stop_limit', limitPrice: '99' },
    check: { orderKind: 'stop_limit', requestedEntry: '105.00', limitPrice: '99.00' },
    canCheckOrder: true,
    canSubmitOrder: true,
    blockedReason: undefined,
  },
];

test('deriveOrderTicket preserves check, submit, and blocked-reason policy', () => {
  const stores = createOrderTicketStores();
  for (const scenario of cases) {
    const input: TicketDerivationInput = {
      ...eligibleTicket,
      ...scenario.input,
      orderCheck: scenario.check === null ? undefined : { ...acceptedCheck, ...scenario.check },
    };
    const result = deriveOrderTicket(input);
    const cachedResult = stores.deriveTicket(input);
    expect(cachedResult).toEqual(result);
    expect(cachedResult.canCheckOrder, scenario.name).toBe(scenario.canCheckOrder);
    expect(cachedResult.canSubmitOrder, scenario.name).toBe(scenario.canSubmitOrder);
    expect(cachedResult.ticketBlockedReason, scenario.name).toBe(scenario.blockedReason);
  }
});

test('ticket-store derivation reuses exact inputs and refreshes gate-critical optional inputs', () => {
  const stores = createOrderTicketStores();
  const initial = stores.deriveTicket(eligibleTicket);

  expect(stores.deriveTicket({ ...eligibleTicket })).toBe(initial);
  expect(initial.canSubmitOrder).toBe(true);

  const closedMarket = stores.deriveTicket({ ...eligibleTicket, marketOpen: false });
  expect(closedMarket).not.toBe(initial);
  expect(closedMarket.canSubmitOrder).toBe(false);
  expect(closedMarket.ticketBlockedReason).toContain('Market is closed');

  const invalidOptionalAllocation: TicketDerivationInput = {
    ...eligibleTicket,
    unitsMode: 'money',
    equityAllocationPercent: '0',
    slOn: false,
    instrument: undefined,
  };
  const allocationFailure = stores.deriveTicket(invalidOptionalAllocation);
  expect(allocationFailure).not.toBe(closedMarket);
  expect(allocationFailure.canCheckOrder).toBe(false);
  expect(allocationFailure.ticketBlockedReason).toBe('Equity allocation must be greater than 0 and at most 100%.');

  const otherProviderStores = createOrderTicketStores();
  expect(otherProviderStores.deriveTicket(eligibleTicket)).not.toBe(initial);
});
