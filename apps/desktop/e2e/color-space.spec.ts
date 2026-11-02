import { expect, test } from '@playwright/test';
import { hexToHsv, hsvToHex, readHexInput } from '../src/shared/theme/colorSpace';

/** The custom-colour editor's colour space: hue, saturation and brightness in, hex out. Pure Node, no browser. */

test('a colour comes back unchanged from its hue, saturation and brightness', () => {
  const roundTrip = (text: string) => {
    const hsv = hexToHsv(text);
    return hsv === undefined ? 'unreadable' : hsvToHex(hsv.hue, hsv.saturation, hsv.value);
  };
  expect(roundTrip('#4caf50')).toBe('#4caf50');
  expect(roundTrip('#ffffff')).toBe('#ffffff');
  expect(roundTrip('#000000')).toBe('#000000');
  expect(roundTrip('#808080')).toBe('#808080');
  expect(roundTrip('nonsense')).toBe('unreadable');
});

test('red, green and blue sit at their own hues', () => {
  expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
  expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
  expect(hsvToHex(240, 1, 1)).toBe('#0000ff');
  // The wheel closes: a hue of 360 is red again.
  expect(hsvToHex(360, 1, 1)).toBe('#ff0000');

  expect(hexToHsv('#ff0000')).toEqual({ hue: 0, saturation: 1, value: 1 });
  expect(hexToHsv('#00ff00')).toEqual({ hue: 120, saturation: 1, value: 1 });
  expect(hexToHsv('#0000ff')).toEqual({ hue: 240, saturation: 1, value: 1 });
});

test('grey keeps the hue it is given, so a colour dragged to grey and back keeps its hue', () => {
  expect(hexToHsv('#808080', 210)?.hue).toBe(210);
  expect(hexToHsv('#ffffff', 40)?.hue).toBe(40);
  expect(hexToHsv('#000000', 300)?.hue).toBe(300);
  expect(hexToHsv('#808080')?.hue).toBe(0);
  expect(hexToHsv('#808080')?.saturation).toBe(0);
  expect(hexToHsv('#808080')?.value).toBeCloseTo(128 / 255);
});

test('text that is no colour has no hue, saturation or value', () => {
  for (const text of ['', 'red', '#12345', '#1234567', '#gggggg']) {
    expect(hexToHsv(text)).toBeUndefined();
  }
});

test('the hex field reads short and long hex in any case, with or without the hash', () => {
  expect(readHexInput('#4CAF50')).toBe('#4caf50');
  expect(readHexInput('4caf50')).toBe('#4caf50');
  expect(readHexInput('#4c5')).toBe('#44cc55');
  expect(readHexInput(' #4caf50 ')).toBe('#4caf50');
  // A colour that carries opacity reads as its solid form, which is all a saved colour keeps.
  expect(readHexInput('#4caf5080')).toBe('#4caf50');
  for (const text of ['', '#4', '#12345', 'red']) {
    expect(readHexInput(text)).toBeUndefined();
  }
});
