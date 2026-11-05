import { expect, test } from '@playwright/test';
import { LineStyle } from 'lightweight-charts';
import { dashPatternOf } from '../src/shared/canvas/dashPatterns';
import { toIndicatorLineStyle, toLibraryLineStyle } from '../src/features/chart/engine/indicators/indicatorLevels';

/**
 * The owner's styled dash: every line the user styles "dashed" draws 6 px on, 6 px off, the same
 * rhythm the chart library's large dash gives a 1 px line. Pure Node spec (no page).
 */

test('a line styled dashed draws 6 px on, 6 px off', () => {
  expect(dashPatternOf('dashed')).toEqual([6, 6]);
});

test('a line styled dotted keeps the 1 px dot every 3 px the dialog previews', () => {
  expect(dashPatternOf('dotted')).toEqual([1, 3]);
});

test('a dashed style reaches the chart library as its large dash', () => {
  expect(toLibraryLineStyle('dashed')).toBe(LineStyle.LargeDashed);
});

test('a line drawn in the large dash reads back as the dashed style', () => {
  expect(toIndicatorLineStyle(LineStyle.LargeDashed)).toBe('dashed');
});
