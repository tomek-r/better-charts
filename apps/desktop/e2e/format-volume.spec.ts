import { expect, test } from '@playwright/test';
import { formatVolume } from '../src/shared/format';

// Pure-module coverage (no browser): the single display rule for every shown volume.
test('formatVolume strips insignificant trailing zeros and a dangling point', () => {
  expect(formatVolume('0.05000000')).toBe('0.05');
  expect(formatVolume('0.10000000')).toBe('0.1');
  expect(formatVolume('1.00000000')).toBe('1');
  expect(formatVolume('12.50')).toBe('12.5');
  expect(formatVolume('10')).toBe('10');
  expect(formatVolume('100.00')).toBe('100');
  expect(formatVolume('0.00000000')).toBe('0');
  expect(formatVolume('1.')).toBe('1');
});

test('formatVolume never loses significant digits', () => {
  expect(formatVolume('0.125')).toBe('0.125');
  expect(formatVolume('0.00000001')).toBe('0.00000001');
  expect(formatVolume('123456789012345678901234.12345600')).toBe('123456789012345678901234.123456');
});

test('formatVolume returns text that is not a plain decimal unchanged', () => {
  expect(formatVolume('')).toBe('');
  expect(formatVolume('abc')).toBe('abc');
  expect(formatVolume('-0.50')).toBe('-0.50');
  expect(formatVolume('1e-7')).toBe('1e-7');
});
