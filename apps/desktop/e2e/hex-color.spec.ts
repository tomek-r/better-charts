import { expect, test } from '@playwright/test';
import { isColorText } from '../src/features/chart/engine/drawings/toolInputs';
import {
  alphaToOpacityPercent,
  colorOpacityPercent,
  formatHexColor,
  mixHexColors,
  opacityPercentToAlpha,
  parseHexColor,
  solidHexColor,
  withAlphaOf,
  withOpacityPercent,
} from '../src/shared/theme/hexColor';

/** Stored colours as `#rrggbb` or `#rrggbbaa`: the pure helpers behind the colour picker. Pure Node, no browser. */

test('parsing reads six digits as an opaque colour and eight digits with their alpha', () => {
  expect(parseHexColor('#3366ff')).toEqual({ red: 51, green: 102, blue: 255, alpha: 255 });
  expect(parseHexColor('#3366FF80')).toEqual({ red: 51, green: 102, blue: 255, alpha: 128 });
});

for (const text of ['', 'red', '#12345', '#1234567', '#123456789', '3366ff', '#33g6ff']) {
  test(`parsing rejects "${text}"`, () => {
    expect(parseHexColor(text)).toBeUndefined();
  });
}

test('an opaque colour formats with six digits and a translucent one with eight', () => {
  expect(formatHexColor({ red: 51, green: 102, blue: 255, alpha: 255 })).toBe('#3366ff');
  expect(formatHexColor({ red: 51, green: 102, blue: 255, alpha: 128 })).toBe('#3366ff80');
  expect(formatHexColor({ red: 0, green: 0, blue: 0, alpha: 0 })).toBe('#00000000');
});

test('formatting what was parsed gives back the stored text', () => {
  for (const text of ['#26a69a', '#f7525f1c', '#ffd200', '#00000000']) {
    expect(formatHexColor(parseHexColor(text)!)).toBe(text);
  }
});

test('opacity percent and alpha byte convert both ways without drifting', () => {
  expect(opacityPercentToAlpha(100)).toBe(255);
  expect(opacityPercentToAlpha(50)).toBe(128);
  expect(opacityPercentToAlpha(0)).toBe(0);
  expect(opacityPercentToAlpha(150)).toBe(255);
  expect(opacityPercentToAlpha(-5)).toBe(0);
  for (let percent = 0; percent <= 100; percent += 1) {
    expect(alphaToOpacityPercent(opacityPercentToAlpha(percent))).toBe(percent);
  }
});

test('full opacity stores six digits and half opacity stores the 80 suffix', () => {
  expect(withOpacityPercent('#3366ff', 50)).toBe('#3366ff80');
  expect(withOpacityPercent('#3366ff80', 100)).toBe('#3366ff');
  expect(withOpacityPercent('not a colour', 50)).toBe('not a colour');
});

test('the solid part and the opacity of a stored colour are read apart', () => {
  expect(solidHexColor('#3366ff80')).toBe('#3366ff');
  expect(solidHexColor('#3366ff')).toBe('#3366ff');
  expect(colorOpacityPercent('#3366ff80')).toBe(50);
  expect(colorOpacityPercent('#3366ff')).toBe(100);
});

test('a new colour can keep the alpha of the colour it replaces', () => {
  expect(withAlphaOf('#00ff00', '#3366ff80')).toBe('#00ff0080');
  expect(withAlphaOf('#00ff00', '#3366ff')).toBe('#00ff00');
});

test('mixing moves each channel toward the other colour', () => {
  expect(mixHexColors('#000000', '#ffffff', 0.5)).toBe('#808080');
  expect(mixHexColors('#ff0000', '#000000', 0.5)).toBe('#800000');
  expect(mixHexColors('#ff0000', '#ffffff', 0)).toBe('#ff0000');
});

test('the colour validator accepts six and eight digits and rejects every other length', () => {
  expect(isColorText('#3366ff')).toBe(true);
  expect(isColorText('#3366ff80')).toBe(true);
  for (const text of ['#3366f', '#3366ff8', '#3366ff801', '3366ff', 'blue', '', 7]) {
    expect(isColorText(text)).toBe(false);
  }
});
