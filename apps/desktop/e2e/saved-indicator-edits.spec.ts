import { expect, test } from '@playwright/test';
import {
  readSavedIndicators,
  sameSavedIndicators,
  type SavedIndicator,
} from '../src/features/chart/chartSettings/savedIndicators';
import {
  DEFAULT_TIMEFRAME_VISIBILITY,
  type DrawingTimeframeVisibility,
} from '../src/features/chart/engine/drawings/timeframeVisibility';
import { indicatorsShownOn } from '../src/features/indicators/indicatorsOnTimeframe';
import {
  withIndicatorHidden,
  withIndicatorPaneHeights,
  withIndicatorSettings,
  withoutIndicator,
} from '../src/features/indicators/savedIndicatorEdits';
import { objectTreeIndicators } from '../src/features/object-tree/objectTreeIndicatorEntries';

/**
 * The edits the object tree makes to the chart's saved indicators, the timeframes an indicator is attached
 * on, and the question of which saved indicators earn a row. All of them are pure, so these cases run
 * without a browser.
 */

/** Two saved indicators of the same plugin, so an edit can be checked against its untouched neighbour. */
const SAVED_SMA_9: SavedIndicator = { instanceId: 'sma-1', definitionId: 'sma', settings: { length: 9 } };
const SAVED_SMA_21: SavedIndicator = { instanceId: 'sma-2', definitionId: 'sma', settings: { length: 21 } };

/** A saved indicator whose definition the registry does not know, so the tree cannot name it. */
const SAVED_UNREGISTERED: SavedIndicator = { instanceId: 'ghost-1', definitionId: 'not-registered', settings: {} };

/** A saved indicator that draws in a pane of its own, so the price-pane tree has no row for it. */
const SAVED_RSI: SavedIndicator = { instanceId: 'rsi-1', definitionId: 'rsi', settings: { length: 14 } };

/** The minutes range the seeded chart opens on (M5), so an indicator limited away from it draws nowhere there. */
const OFF_MINUTES: DrawingTimeframeVisibility = {
  ...DEFAULT_TIMEFRAME_VISIBILITY,
  minutes: { shown: false, from: 1, to: 30 },
};

/** The same saved moving average, limited to the timeframes this chart's minutes range excludes. */
const SAVED_LIMITED_SMA_9: SavedIndicator = { ...SAVED_SMA_9, timeframeVisibility: OFF_MINUTES };

/** The own-pane indicator the height cases resize, hidden and limited, so an edit has to keep more than its id. */
const SAVED_LIMITED_RSI: SavedIndicator = { ...SAVED_RSI, hidden: true, timeframeVisibility: OFF_MINUTES };

/** A height the user dragged the RSI's pane to, relative to the price pane. */
const DRAGGED_RSI_PANE_HEIGHT = 0.4;

test('hiding marks only its own entry, and showing takes the key away again', () => {
  const hidden = withIndicatorHidden([SAVED_SMA_9, SAVED_SMA_21], SAVED_SMA_9.instanceId, true);

  expect(hidden).toEqual([{ ...SAVED_SMA_9, hidden: true }, SAVED_SMA_21]);

  const [shown] = withIndicatorHidden(hidden, SAVED_SMA_9.instanceId, false);

  expect(shown !== undefined && 'hidden' in shown).toBe(false);
  expect(shown).toEqual(SAVED_SMA_9);
});

test('showing a hidden entry keeps the timeframes it shows on', () => {
  const [shown] = withIndicatorHidden([{ ...SAVED_LIMITED_SMA_9, hidden: true }], SAVED_SMA_9.instanceId, false);

  expect(shown !== undefined && 'hidden' in shown).toBe(false);
  expect(shown).toEqual(SAVED_LIMITED_SMA_9);
});

test('new settings replace only those of their own entry', () => {
  const edited = withIndicatorSettings([SAVED_SMA_9, SAVED_SMA_21], SAVED_SMA_21.instanceId, { length: 50 });

  expect(edited).toEqual([SAVED_SMA_9, { ...SAVED_SMA_21, settings: { length: 50 } }]);
});

test('new settings carry a named visibility, and every timeframe takes the key away', () => {
  const limited = withIndicatorSettings([SAVED_SMA_9], SAVED_SMA_9.instanceId, { length: 9 }, OFF_MINUTES);

  expect(limited).toEqual([SAVED_LIMITED_SMA_9]);

  const [unlimited] = withIndicatorSettings(
    limited,
    SAVED_SMA_9.instanceId,
    { length: 9 },
    DEFAULT_TIMEFRAME_VISIBILITY,
  );

  expect(unlimited !== undefined && 'timeframeVisibility' in unlimited).toBe(false);
  expect(unlimited).toEqual(SAVED_SMA_9);
});

test('new settings without a visibility keep the one the entry stores', () => {
  const edited = withIndicatorSettings([SAVED_LIMITED_SMA_9], SAVED_SMA_9.instanceId, { length: 50 });

  expect(edited).toEqual([{ ...SAVED_LIMITED_SMA_9, settings: { length: 50 } }]);
});

test('removing drops only its own entry', () => {
  const remaining = withoutIndicator([SAVED_SMA_9, SAVED_SMA_21], SAVED_SMA_9.instanceId);

  expect(remaining).toEqual([SAVED_SMA_21]);
});

test('a dragged pane height lands on its own entry and keeps everything else it stores', () => {
  const resized = withIndicatorPaneHeights(
    [SAVED_LIMITED_RSI, SAVED_SMA_9],
    [{ instanceId: SAVED_RSI.instanceId, paneHeight: DRAGGED_RSI_PANE_HEIGHT }],
  );

  expect(resized).toEqual([{ ...SAVED_LIMITED_RSI, paneHeight: DRAGGED_RSI_PANE_HEIGHT }, SAVED_SMA_9]);
});

test('readSavedIndicators keeps a limited visibility and drops a default or unreadable one', () => {
  const read = readSavedIndicators([
    { instanceId: 'a', definitionId: 'sma', settings: {}, timeframeVisibility: OFF_MINUTES },
    { instanceId: 'b', definitionId: 'sma', settings: {}, timeframeVisibility: DEFAULT_TIMEFRAME_VISIBILITY },
    { instanceId: 'c', definitionId: 'sma', settings: {}, timeframeVisibility: 'minutes' },
  ]);

  expect(read?.map((entry) => entry.instanceId)).toEqual(['a', 'b', 'c']);
  expect(read?.[0]?.timeframeVisibility).toEqual(OFF_MINUTES);
  // The default and an unreadable value both read as every timeframe, which stores no key at all.
  expect(read?.slice(1).some((entry) => 'timeframeVisibility' in entry)).toBe(false);
});

test('sameSavedIndicators tells two entries apart by the timeframes they show on', () => {
  expect(sameSavedIndicators([SAVED_SMA_9], [SAVED_LIMITED_SMA_9])).toBe(false);
  expect(sameSavedIndicators([SAVED_LIMITED_SMA_9], [SAVED_LIMITED_SMA_9])).toBe(true);
});

test('sameSavedIndicators tells two entries apart by the height of their pane', () => {
  const resized: SavedIndicator = { ...SAVED_RSI, paneHeight: DRAGGED_RSI_PANE_HEIGHT };

  expect(sameSavedIndicators([SAVED_RSI], [resized])).toBe(false);
  expect(sameSavedIndicators([resized], [resized])).toBe(true);
});

test('an indicator limited away from a timeframe is attached only on the other ones', () => {
  const saved = [SAVED_LIMITED_SMA_9, SAVED_SMA_21];

  expect(indicatorsShownOn(saved, 'M5')).toEqual([SAVED_SMA_21]);
  expect(indicatorsShownOn(saved, 'H1')).toEqual(saved);
  expect(indicatorsShownOn(saved, undefined)).toEqual(saved);
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
