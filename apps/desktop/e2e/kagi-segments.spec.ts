import { expect, test } from '@playwright/test';
import {
  kagiStrokes,
  openingStyleOf,
  type KagiBar,
  type KagiStroke,
} from '../src/features/chart/engine/barStyle/kagi/kagiStrokes';

/**
 * The Kagi line's yang/yin segmentation: which style each stroke is drawn in, and the price inside a stroke where
 * the line changes style. The bars are the prices the backend's Kagi command draws, one stroke per bar.
 */

/** The strokes the line draws through the `[open, close]` pairs handed in, in the bars' own order. */
function strokesOf(...pairs: [number, number][]): KagiStroke[] {
  const bars: KagiBar[] = pairs.map(([open, close]) => ({ open, close }));
  return kagiStrokes(bars);
}

/** What each stroke is drawn in: `style` alone, or `style@price` where the line changed style inside it. */
function drawnStyles(...pairs: [number, number][]): string[] {
  return strokesOf(...pairs).map((stroke) =>
    stroke.brokenLevel === null ? stroke.style : `${stroke.style}@${stroke.brokenLevel}`,
  );
}

test('the first stroke has no shoulder to break, so the line opens thin', () => {
  expect(strokesOf([10, 12])).toEqual([{ open: 10, close: 12, style: 'yin', brokenLevel: null }]);
  // A stroke that kept its style is drawn in that style from its own open on.
  expect(openingStyleOf(strokesOf([10, 12])[0])).toBe('yin');
});

test('an up stroke that rises above the previous shoulder turns thick at that price', () => {
  // Up to 12, back to 11, then up through the 12 the first stroke reached.
  expect(drawnStyles([10, 12], [12, 11], [11, 13])).toEqual(['yin', 'yin', 'yang@12']);
  // The third stroke opened thin, so the renderer draws the part below 12 in the style it started in.
  expect(openingStyleOf(strokesOf([10, 12], [12, 11], [11, 13])[2])).toBe('yin');
});

test('a down stroke that holds above the previous waist keeps the thick yang style', () => {
  // Yang from 12 on, then down from 13 to 12: still above the 11 the last down stroke reached.
  expect(drawnStyles([10, 12], [12, 11], [11, 13], [13, 12])).toEqual(['yin', 'yin', 'yang@12', 'yang']);
});

test('a down stroke that falls below the previous waist turns thin at that price', () => {
  const strokes = strokesOf([10, 12], [12, 11], [11, 13], [13, 12], [12, 14], [14, 9]);

  // The last fall reached 12, so the 9 the final stroke reaches turns the line thin at 12.
  expect(strokes.at(-1)).toEqual({ open: 14, close: 9, style: 'yin', brokenLevel: 12 });
  expect(openingStyleOf(strokes[strokes.length - 1])).toBe('yang');
});

test('the shoulder follows the last up stroke and the waist the last down stroke', () => {
  // Yang at 12, then a fall through the waist turns the line thin again. The next rise is read against the 12.5
  // the up stroke after that fall reached, not against the 13 of the stroke that turned the line yang.
  expect(drawnStyles([10, 12], [12, 11], [11, 13], [13, 10], [10, 12.5], [12.5, 11], [11, 13.5])).toEqual([
    'yin',
    'yin',
    'yang@12',
    'yin@11',
    'yin',
    'yin',
    'yang@12.5',
  ]);
});
