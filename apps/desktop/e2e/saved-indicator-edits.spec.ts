import { expect, test } from '@playwright/test';
import type { SavedIndicator } from '../src/features/chart/chartSettings/savedIndicators';
import {
  withIndicatorHidden,
  withIndicatorSettings,
  withoutIndicator,
} from '../src/features/indicators/savedIndicatorEdits';
import { objectTreeIndicators } from '../src/features/object-tree/objectTreeIndicatorEntries';

/**
 * The edits the object tree makes to the chart's saved indicators, and the question of which saved
 * indicators earn a row. Both are pure, so these cases run without a browser.
 */

/** Two saved indicators of the same plugin, so an edit can be checked against its untouched neighbour. */
const SAVED_SMA_9: SavedIndicator = { instanceId: 'sma-1', definitionId: 'sma', settings: { length: 9 } };
const SAVED_SMA_21: SavedIndicator = { instanceId: 'sma-2', definitionId: 'sma', settings: { length: 21 } };

/** A saved indicator whose definition the registry does not know, so the tree cannot name it. */
const SAVED_UNREGISTERED: SavedIndicator = { instanceId: 'ghost-1', definitionId: 'not-registered', settings: {} };

/** A saved indicator that draws in a pane of its own, so the price-pane tree has no row for it. */
const SAVED_RSI: SavedIndicator = { instanceId: 'rsi-1', definitionId: 'rsi', settings: { length: 14 } };

test('hiding marks only its own entry, and showing takes the key away again', () => {
  const hidden = withIndicatorHidden([SAVED_SMA_9, SAVED_SMA_21], SAVED_SMA_9.instanceId, true);

  expect(hidden).toEqual([{ ...SAVED_SMA_9, hidden: true }, SAVED_SMA_21]);

  const [shown] = withIndicatorHidden(hidden, SAVED_SMA_9.instanceId, false);

  expect(shown !== undefined && 'hidden' in shown).toBe(false);
  expect(shown).toEqual(SAVED_SMA_9);
});

test('new settings replace only those of their own entry', () => {
  const edited = withIndicatorSettings([SAVED_SMA_9, SAVED_SMA_21], SAVED_SMA_21.instanceId, { length: 50 });

  expect(edited).toEqual([SAVED_SMA_9, { ...SAVED_SMA_21, settings: { length: 50 } }]);
});

test('removing drops only its own entry', () => {
  const remaining = withoutIndicator([SAVED_SMA_9, SAVED_SMA_21], SAVED_SMA_9.instanceId);

  expect(remaining).toEqual([SAVED_SMA_21]);
});

test('the tree lists a registered price-pane indicator and drops an unknown definition', () => {
  const listed = objectTreeIndicators([SAVED_SMA_9, SAVED_UNREGISTERED]);

  expect(listed).toHaveLength(1);
  expect(listed[0]?.saved.definitionId).toBe('sma');
  expect(listed[0]?.plugin.pane).toBe('overlay');
});

test('the tree drops a saved own-pane indicator and keeps the price-pane one', () => {
  const listed = objectTreeIndicators([SAVED_RSI, SAVED_SMA_9]);

  expect(listed.map((entry) => entry.saved.definitionId)).toEqual(['sma']);
});
