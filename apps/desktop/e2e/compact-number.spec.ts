import { expect, test } from '@playwright/test';
import { formatCompactNumber } from '../src/shared/compactNumber';

/** The short volume text of the chart labels. Pure Node. */

const CASES: ReadonlyArray<[number, string]> = [
  [0, '0'],
  [24, '24'],
  [999, '999'],
  [1000, '1K'],
  [1350, '1.35K'],
  [9184, '9.18K'],
  [12_000, '12K'],
  [100_000, '100K'],
  [123_456, '123K'],
  [999_500, '1M'],
  [1_250_000, '1.25M'],
  [3_400_000_000, '3.4B'],
  [12.5, '12.5'],
  [0.126, '0.13'],
  [0.004, '0'],
  [-18, '−18'],
  [-1350, '−1.35K'],
  [-0.001, '0'],
];

for (const [value, text] of CASES) {
  test(`formats ${value} as ${text}`, () => {
    expect(formatCompactNumber(value)).toBe(text);
  });
}

test('a number that is not finite reads as zero', () => {
  expect(formatCompactNumber(Number.NaN)).toBe('0');
});
