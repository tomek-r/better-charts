import { expect, test } from '@playwright/test';
import {
  INTERVAL_OUT_OF_RANGE_MESSAGE,
  INTERVAL_UNREADABLE_MESSAGE,
  MAX_TICKS_PER_BAR,
  chartIntervalOf,
  isDrawableInterval,
  parseIntervalInput,
  type ChartInterval,
} from '../src/shared/bridge/chartIntervalModel';
import { intervalLabel, intervalLongLabel, isTickInterval, ticksPerBarOf } from '../src/shared/bridge/chartIntervals';
import { restorableSelection } from '../src/features/bridge/lastChartSelection/lastChartSelection';
import { loadTimeframeFavorites } from '../src/features/chart/timeframes/timeframeFavorites';

/**
 * The interval model: the codes it recognises, the text the user types into it,
 * the labels it shows, and which of those codes the rest of the app accepts today.
 */

/** The interval `text` parses to, failing the case when the text names none. */
function intervalOf(text: string): ChartInterval {
  const parsed = parseIntervalInput(text);
  if (!parsed.ok) {
    throw new Error(`"${text}" should parse, but: ${parsed.message}`);
  }
  return parsed.interval;
}

/** The message `text` is refused with, failing the case when it parses to an interval. */
function refusalOf(text: string): string {
  const parsed = parseIntervalInput(text);
  if (parsed.ok) {
    throw new Error(`"${text}" should be refused, but it names ${parsed.interval.code}.`);
  }
  return parsed.message;
}

/** Text a user types and the canonical code it names, as TradingView reads it. */
const TYPED_CODES: readonly (readonly [string, string])[] = [
  ['37T', 'T37'],
  ['37t', 'T37'],
  ['T37', 'T37'],
  ['5s', 'S5'],
  ['5S', 'S5'],
  ['7', 'M7'],
  ['7m', 'M7'],
  ['5h', 'H5'],
  ['5H', 'H5'],
  ['H5', 'H5'],
  ['5D', 'D5'],
  ['5d', 'D5'],
  ['2W', 'W2'],
  ['2w', 'W2'],
  ['  2W  ', 'W2'],
  ['4M', 'MN4'],
  ['H4', 'H4'],
  ['MN1', 'MN1'],
];

test.describe('parsing an interval the user typed', () => {
  test('every typed form names its canonical code', () => {
    for (const [typed, code] of TYPED_CODES) {
      expect(intervalOf(typed).code).toBe(code);
    }
  });

  test('a bare number is minutes, and the capital M is months', () => {
    expect(intervalOf('7')).toEqual({ kind: 'aggregated', code: 'M7', unit: 'M', count: 7, base: 'M1' });
    expect(intervalOf('7m')).toEqual(intervalOf('7'));
    expect(intervalOf('4M')).toEqual({ kind: 'aggregated', code: 'MN4', unit: 'MN', count: 4, base: 'MN1' });
  });

  test('a native code typed as such stays native, and a tick code keeps its count', () => {
    expect(intervalOf('H4')).toEqual({ kind: 'native', code: 'H4' });
    expect(intervalOf('MN1')).toEqual({ kind: 'native', code: 'MN1' });
    expect(intervalOf('37T')).toEqual({ kind: 'ticks', code: 'T37', ticksPerBar: 37 });
    expect(intervalOf('5s')).toEqual({ kind: 'seconds', code: 'S5', seconds: 5 });
  });

  test('text that names no interval is refused with the unreadable message', () => {
    for (const text of ['', '   ', 'abc', '1.5h', 't37.5', 'h', '5mm', '-5']) {
      expect(refusalOf(text)).toBe(INTERVAL_UNREADABLE_MESSAGE);
    }
  });

  test('a zero or a count over its unit’s cap is refused with the out-of-range message', () => {
    const overItsCap = ['0', '0T', `${MAX_TICKS_PER_BAR + 1}T`, '1441m', '25h', '366D', '53W', '13M', '86401s'];
    for (const text of overItsCap) {
      expect(refusalOf(text)).toBe(INTERVAL_OUT_OF_RANGE_MESSAGE);
    }
  });
});

test.describe('classifying a code into the bars it needs', () => {
  test('native codes, ticks and seconds are named by their own kind', () => {
    expect(chartIntervalOf('M5')).toEqual({ kind: 'native', code: 'M5' });
    expect(chartIntervalOf('H12')).toEqual({ kind: 'native', code: 'H12' });
    expect(chartIntervalOf('T37')).toEqual({ kind: 'ticks', code: 'T37', ticksPerBar: 37 });
    expect(chartIntervalOf('S5')).toEqual({ kind: 'seconds', code: 'S5', seconds: 5 });
  });

  test('every other time code is aggregated from the largest native timeframe that divides it', () => {
    const bases: readonly (readonly [string, string])[] = [
      ['M7', 'M1'],
      ['M90', 'M30'],
      ['H5', 'H1'],
      ['D5', 'D1'],
      ['W2', 'W1'],
      ['MN4', 'MN1'],
    ];
    for (const [code, base] of bases) {
      expect(chartIntervalOf(code)).toMatchObject({ kind: 'aggregated', base });
    }
    expect(chartIntervalOf('M90')).toEqual({ kind: 'aggregated', code: 'M90', unit: 'M', count: 90, base: 'M30' });
  });

  test('a code the model does not know belongs to no interval', () => {
    for (const code of ['BOGUS', 'T0', 'T100001', 'M0', 'MN0', 'X9', 'm7', '']) {
      expect(chartIntervalOf(code)).toBeUndefined();
    }
  });

  test('native, N-tick and seconds intervals can be drawn; aggregated ones not yet', () => {
    expect(isDrawableInterval('M5')).toBe(true);
    expect(isDrawableInterval('T37')).toBe(true);
    expect(isDrawableInterval('S5')).toBe(true);
    expect(isDrawableInterval('D5')).toBe(false);
    expect(isDrawableInterval('BOGUS')).toBe(false);
  });
});

test.describe('labelling an interval', () => {
  test('short labels read as the menu and the chart button show them', () => {
    expect(intervalLabel('T37')).toBe('37T');
    expect(intervalLabel('T1')).toBe('1T');
    expect(intervalLabel('T1000')).toBe('1000T');
    expect(intervalLabel('S5')).toBe('5s');
    expect(intervalLabel('M7')).toBe('7m');
    expect(intervalLabel('M90')).toBe('90m');
    expect(intervalLabel('H5')).toBe('5H');
    expect(intervalLabel('D5')).toBe('5D');
    expect(intervalLabel('W2')).toBe('2W');
    expect(intervalLabel('MN4')).toBe('4M');
  });

  test('a native code keeps the labels the timeframe list already gives it', () => {
    expect(intervalLabel('M15')).toBe('15m');
    expect(intervalLabel('H4')).toBe('4H');
    expect(intervalLabel('MN1')).toBe('1M');
    expect(intervalLongLabel('H1')).toBe('1 hour');
    expect(intervalLongLabel('MN1')).toBe('1 month');
  });

  test('long labels count their unit out, singular for one', () => {
    expect(intervalLongLabel('T1')).toBe('1 tick');
    expect(intervalLongLabel('T37')).toBe('37 ticks');
    expect(intervalLongLabel('S1')).toBe('1 second');
    expect(intervalLongLabel('S5')).toBe('5 seconds');
    expect(intervalLongLabel('M7')).toBe('7 minutes');
    expect(intervalLongLabel('H5')).toBe('5 hours');
    expect(intervalLongLabel('D5')).toBe('5 days');
    expect(intervalLongLabel('W2')).toBe('2 weeks');
    expect(intervalLongLabel('MN4')).toBe('4 months');
  });
});

test.describe('recognising N-tick codes everywhere a tick code is read', () => {
  test('any in-range tick count is a tick interval, whatever the menu presets list', () => {
    expect(ticksPerBarOf('T37')).toBe(37);
    expect(ticksPerBarOf(`T${MAX_TICKS_PER_BAR}`)).toBe(MAX_TICKS_PER_BAR);
    expect(isTickInterval(`T${MAX_TICKS_PER_BAR}`)).toBe(true);
    expect(isTickInterval(`T${MAX_TICKS_PER_BAR + 1}`)).toBe(false);
    expect(isTickInterval('M10')).toBe(false);
    expect(isTickInterval(undefined)).toBe(false);
    expect(ticksPerBarOf('S5')).toBeUndefined();
    expect(ticksPerBarOf('D5')).toBeUndefined();
  });
});

/** A saved window on `timeframe`, which the start reads back to reopen it. */
const savedOn = (timeframe: string) => ({ symbol: 'EURUSD', timeframe });

test.describe('restoring and starring an interval', () => {
  test('a saved N-tick window reopens without asking the handshake for it', () => {
    expect(restorableSelection(savedOn('T37'), ['M1', 'M5'])).toEqual(savedOn('T37'));
    expect(restorableSelection(savedOn(`T${MAX_TICKS_PER_BAR}`), [])).toEqual(savedOn(`T${MAX_TICKS_PER_BAR}`));
  });

  test('an interval no slice draws yet is not restored', () => {
    expect(restorableSelection(savedOn('S5'), ['M1', 'M5'])).toEqual(savedOn('S5'));
    expect(restorableSelection(savedOn('D5'), ['M1', 'D1'])).toBeUndefined();
    expect(restorableSelection(savedOn('M7'), ['M1', 'M5'])).toBeUndefined();
  });

  test('an MT5 code still needs the handshake to advertise it', () => {
    expect(restorableSelection(savedOn('M2'), ['M1'])).toBeUndefined();
    expect(restorableSelection(savedOn('M2'), ['M1', 'M2'])).toEqual(savedOn('M2'));
  });

  test('the favorites keep any N-tick code and drop the intervals no slice draws yet', () => {
    const stored = (value: string) => ({ getItem: () => value });

    expect(loadTimeframeFavorites(stored('["T37","T100000"]'))).toEqual(['T37', 'T100000']);
    expect(loadTimeframeFavorites(stored('["S5","D5","M7","T10","BOGUS"]'))).toEqual(['S5', 'T10']);
  });
});
