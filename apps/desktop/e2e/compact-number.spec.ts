import { expect, test } from '@playwright/test';
import { formatCompactNumber } from '../src/shared/compactNumber';

/** The short volume text of the chart labels. Pure Node. */

const CASES: ReadonlyArray<[number, string]> = [
  [0, '0'],
  [24, '24'],
  [999, '999'],
  [987.65, '988'],
  [999.999, '1 K'],
  [1000, '1 K'],
  [1350, '1.35 K'],
  [5183, '5.18 K'],
  [9184, '9.18 K'],
  [12_000, '12 K'],
  [100_000, '100 K'],
  [123_456, '123.46 K'],
  [999_500, '999.5 K'],
  [999_999, '1 M'],
  [1_250_000, '1.25 M'],
  [3_400_000_000, '3.4 B'],
  [12.4, '12'],
  [0.126, '0'],
  [0.004, '0'],
  [-18, '−18'],
  [-1350, '−1.35 K'],
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
