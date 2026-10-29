import { test, expect } from '@playwright/test';
import {
  deriveOrderTicket,
  type TicketDerivationInput,
} from '../src/features/order-ticket/derivation/deriveOrderTicket';
import type { OrderCheckResult } from '../src/shared/bridge/types';
import { ticketScenario } from './helpers/ticketFixtures';

const MARKET_CLOSED = 'Market is closed for this symbol — trading resumes when the session opens.';
const TAKE_PROFIT_TOO_CLOSE = 'take_profit too close: distance 10 pts, required >= 20 pts (20 ticks margin)';
const NO_ACCEPTED_CHECK = 'Run OrderCheck in MT5 — an accepted result for the current draft is required.';

type BlockedReasonCase = {
  name: string;
  input?: Partial<TicketDerivationInput>;
  check?: Partial<OrderCheckResult> | null;
  reason: string | undefined;
};

const cases: BlockedReasonCase[] = [
  { name: 'eligible ticket has no reason', reason: undefined },
  {
    name: 'unknown market session waits for the heartbeat',
    input: { marketOpen: undefined },
    reason: 'Market session is unavailable — waiting for the bridge heartbeat.',
  },
  {
    name: 'unknown market session still loses to a disconnected bridge',
    input: { marketOpen: undefined, bridgeState: 'disconnected' },
    reason: 'Bridge not connected.',
  },
  { name: 'closed market', input: { marketOpen: false }, reason: MARKET_CLOSED },
  { name: 'zero volume', input: { orderVolume: '0' }, reason: 'Volume must be a positive decimal.' },
  { name: 'volume above the maximum', input: { orderVolume: '1000' }, reason: 'Volume must be between 0.01 and 100.' },
  { name: 'volume below the minimum', input: { orderVolume: '0.005' }, reason: 'Volume must be between 0.01 and 100.' },
  {
    name: 'volume off the step',
    input: { orderVolume: '0.015' },
    reason: 'Volume must respect 0.01 step (min 0.01, max 100)',
  },
  {
    name: 'market-closed reason wins over a volume issue',
    input: { marketOpen: false, orderVolume: '0' },
    reason: MARKET_CLOSED,
  },
  {
    name: 'volume reason wins over a take-profit that is too close',
    input: { orderVolume: '', tpOn: true, takeProfit: '100.10' },
    reason: 'Volume is required.',
  },
  {
    name: 'take-profit distance reason is printed',
    input: { tpOn: true, takeProfit: '100.10' },
    reason: TAKE_PROFIT_TOO_CLOSE,
  },
  {
    name: 'take-profit distance reason wins over allocation failure',
    input: { tpOn: true, takeProfit: '100.10', unitsMode: 'money', equityAllocationPercent: '0' },
    reason: TAKE_PROFIT_TOO_CLOSE,
  },
  {
    name: 'take-profit distance reason wins over a missing accepted check',
    input: { tpOn: true, takeProfit: '100.10' },
    check: null,
    reason: TAKE_PROFIT_TOO_CLOSE,
  },
  {
    name: 'too-close stop prints an empty reason even when the take profit is also too close',
    input: { slOn: true, stopLoss: '100', tpOn: true, takeProfit: '100.10' },
    reason: '',
  },
  {
    name: 'missing accepted check wins over a changed volume echo',
    check: { draftVersion: 2, volume: '0.1' },
    reason: NO_ACCEPTED_CHECK,
  },
  {
    name: 'required preview wins over a changed volume echo',
    input: { slOn: true, unitsMode: 'money', riskPreview: undefined },
    check: { volume: '0.1', stopLoss: '99.00' },
    reason: '',
  },
  {
    name: 'changed volume echo wins over invalid entry',
    input: { entry: '1e2' },
    check: { volume: '0.1' },
    reason: 'Volume changed — run OrderCheck in MT5 again.',
  },
  {
    name: 'enabled stop loss without a price',
    input: { slOn: true, stopLoss: '' },
    reason: 'Entry and stop loss must be valid prices.',
  },
  {
    name: 'invalid take profit',
    input: { tpOn: true, takeProfit: 'oops' },
    reason: 'Take profit must be a valid price or empty.',
  },
  { name: 'account echo mismatch is generic', check: { accountLogin: '654321' }, reason: 'Order panel is not ready.' },
];

test('ticketBlockedReason keeps its ordered precedence and exact texts', () => {
  for (const scenario of cases) {
    const result = deriveOrderTicket(ticketScenario(scenario.input, scenario.check));
    expect(result.ticketBlockedReason, scenario.name).toBe(scenario.reason);
  }
});
