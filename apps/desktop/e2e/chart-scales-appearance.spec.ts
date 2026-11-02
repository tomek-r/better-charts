import { expect, test } from '@playwright/test';
import type { ScalesSettingValues } from '../src/features/chart/chartSettings/chartSettings';
import { chartTimeLabelsOf, scalesAppearanceOf } from '../src/features/chart/chartSettings/scalesAppearanceSetting';
import { scalesFields } from '../src/features/chart/chartSettings/scalesSettings';
import type { ChartSettingValue } from '../src/features/chart/chartSettings/settingFields';
import { palette } from '../src/shared/theme/palette';

/**
 * The Scales and lines settings read back as the chart draws them: the A/L row, the countdown tag,
 * the Bid/Ask quote and the time labels, each field falling back to its default on its own. Pure Node.
 */

/** What a chart draws when nothing has been stored: the scales and lines it has always had. */
const DEFAULTS = {
  scaleModeButtons: 'mouseOver',
  countdown: true,
  bidAsk: { mode: 'lineAndLabel', bid: palette.sell, ask: palette.buy },
  timeLabels: { dayOfWeek: true, dateFormat: 'dayMonthYear', hourFormat: 'h24' },
};

/** Every scales field's declared default, keyed as the stored settings are. */
function declaredDefaults(): Record<string, ChartSettingValue> {
  const defaults: Record<string, ChartSettingValue> = {};
  for (const field of scalesFields()) {
    defaults[field.key] = field.defaultValue;
  }
  return defaults;
}

test('no stored value reads as the scales and lines the chart has always drawn', () => {
  expect(scalesAppearanceOf({})).toEqual(DEFAULTS);
});

test('the scales fields the dialog declares default to what the chart draws', () => {
  expect(scalesAppearanceOf(declaredDefaults())).toEqual(DEFAULTS);
});

test('every scales setting reads back the value it names', () => {
  const stored: ScalesSettingValues = {
    scaleModeButtons: 'always',
    countdown: false,
    bidAsk: { mode: 'label', bid: '#112233', ask: '#445566' },
    dayOfWeek: false,
    dateFormat: 'monthDayNumeric',
    hourFormat: 'h12',
  };
  expect(scalesAppearanceOf(stored)).toEqual({
    scaleModeButtons: 'always',
    countdown: false,
    bidAsk: { mode: 'label', bid: '#112233', ask: '#445566' },
    timeLabels: { dayOfWeek: false, dateFormat: 'monthDayNumeric', hourFormat: 'h12' },
  });
});

test('a field with no stored value keeps the default of that field alone', () => {
  expect(scalesAppearanceOf({ dateFormat: 'iso' })).toEqual({
    ...DEFAULTS,
    timeLabels: { dayOfWeek: true, dateFormat: 'iso', hourFormat: 'h24' },
  });
});

test('the footer clock reads its hour format from the same fields as the chart', () => {
  expect(chartTimeLabelsOf({ hourFormat: 'h12' })).toEqual({
    dayOfWeek: true,
    dateFormat: 'dayMonthYear',
    hourFormat: 'h12',
  });
});
