import { mixHexColors } from '../../theme/hexColor';

/** The preset colours of the picker: ten columns, a greyscale row, a row of saturated hues and tinted rows. */

export const PALETTE_COLUMNS = 10;

/** White to black. */
export const GREYSCALE_ROW: readonly string[] = [
  '#ffffff',
  '#e0e0e0',
  '#c2c2c2',
  '#a3a3a3',
  '#858585',
  '#686868',
  '#4d4d4d',
  '#333333',
  '#1a1a1a',
  '#000000',
];

/** Red, orange, yellow, green, teal, cyan, blue, indigo, purple, pink. */
export const HUE_ROW: readonly string[] = [
  '#f23645',
  '#ff9800',
  '#ffeb3b',
  '#4caf50',
  '#089981',
  '#00bcd4',
  '#2962ff',
  '#673ab7',
  '#9c27b0',
  '#e91e63',
];

const WHITE = '#ffffff';
const BLACK = '#000000';

/** How far each tint or shade row moves every hue toward white or black, lightest row first, darkest last. */
const TINT_AND_SHADE_STEPS: ReadonlyArray<{ readonly toward: string; readonly amount: number }> = [
  { toward: WHITE, amount: 0.8 },
  { toward: WHITE, amount: 0.6 },
  { toward: WHITE, amount: 0.4 },
  { toward: BLACK, amount: 0.15 },
  { toward: BLACK, amount: 0.35 },
  { toward: BLACK, amount: 0.55 },
];

/** Six rows of the same ten hues, from the lightest tint to the darkest shade. */
export const TINT_AND_SHADE_ROWS: ReadonlyArray<readonly string[]> = TINT_AND_SHADE_STEPS.map(({ toward, amount }) =>
  HUE_ROW.map((hue) => mixHexColors(hue, toward, amount)),
);
