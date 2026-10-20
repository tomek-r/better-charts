import { test, expect } from '@playwright/test';
import { flipExits, sideReference } from '../src/features/order-ticket/domain/sideFlip';

test('each side measures from its own quote', () => {
  expect(sideReference('buy')).toBe('ask');
  expect(sideReference('sell')).toBe('bid');
});

test('enabled exits are mirrored across the new entry at their old distance', () => {
  const draft = { entry: '100.0', stopLoss: '95.0', takeProfit: '110.0', slOn: true, tpOn: true };
  expect(flipExits(draft, 99.5, 1)).toEqual({ stopLoss: '104.5', takeProfit: '89.5' });
  // A disabled level stays off; the enabled one still flips.
  expect(flipExits({ ...draft, tpOn: false }, 99.5, 1)).toEqual({ stopLoss: '104.5', takeProfit: '' });
});

test('nothing to flip or an unusable price starts a fresh draft', () => {
  const draft = { entry: '100.0', stopLoss: '95.0', takeProfit: '110.0', slOn: false, tpOn: false };
  expect(flipExits(draft, 99.5, 1)).toBeUndefined();
  expect(flipExits({ ...draft, slOn: true, entry: '' }, 99.5, 1)).toBeUndefined();
  // A mirrored level that would fall to zero or below cannot be placed.
  expect(flipExits({ ...draft, tpOn: true, takeProfit: '300.0' }, 99.5, 1)).toBeUndefined();
});
