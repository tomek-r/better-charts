import { expect, test } from '@playwright/test';

import {
  BAR_STYLE_GROUPS,
  BAR_STYLES,
  barStyleLabel,
  isBarStyle,
} from '../src/features/chart/engine/barStyle/barStyles';
import { BAR_STYLE_SETTINGS } from '../src/features/chart/chartSettings/barStyleSettings';
import { CANVAS_SETTINGS, canvasFields } from '../src/features/chart/chartSettings/canvasSettings';
import {
  DEFAULT_CHART_SETTINGS,
  chartSettingsOverrides,
  readChartSettingsLayer,
  resolveChartSettings,
  withCanvasValue,
  withSettingValue,
  withTimeZone,
} from '../src/features/chart/chartSettings/chartSettings';
import { EXCHANGE_TIME_ZONE } from '../src/features/chart/timeZone/chartTimeZones';
import { palette } from '../src/shared/theme/palette';

test('resolving no layers gives the built-in default settings', () => {
  const resolved = resolveChartSettings([]);

  expect(resolved).toEqual(DEFAULT_CHART_SETTINGS);
  expect(resolved.barStyle).toBe('candles');
  expect(resolved.timeZone).toBe(EXCHANGE_TIME_ZONE);
  expect(resolved.barStyles.candles.body).toEqual({ visible: true, up: '#26a69a', down: '#f7525f' });
  expect(resolved.barStyles.candles.borders).toEqual({
    visible: false,
    up: '#26a69a',
    down: '#f7525f',
  });
});

test('a chart override wins per field over the template it starts from', () => {
  const templateLayer = readChartSettingsLayer({
    barStyle: 'line',
    barStyles: {
      candles: {
        colorByPreviousClose: true,
        wick: { visible: false, up: '#26a69a', down: '#f7525f' },
      },
    },
  });
  const overrideLayer = readChartSettingsLayer({
    timeZone: 'UTC',
    barStyles: { candles: { wick: { visible: true, up: '#26a69a', down: '#f7525f' } } },
  });

  const resolved = resolveChartSettings([templateLayer, overrideLayer]);

  expect(resolved.barStyle).toBe('line');
  expect(resolved.timeZone).toBe('UTC');
  expect(resolved.barStyles.candles.wick).toEqual({
    visible: true,
    up: '#26a69a',
    down: '#f7525f',
  });
  expect(resolved.barStyles.candles.colorByPreviousClose).toBe(true);
  expect(resolved.barStyles.candles.body).toEqual(DEFAULT_CHART_SETTINGS.barStyles.candles.body);
});

test('a stored layer keeps the fields it can read and drops the rest', () => {
  const layer = readChartSettingsLayer({
    barStyle: 'renko',
    timeZone: 'Mars/Olympus',
    barStyles: {
      candles: {
        colorByPreviousClose: true,
        unknownField: 3,
        wick: { visible: true, up: 'nope', down: '#f7525f' },
        body: { visible: true, up: '#26a69a' },
      },
      line: { lineWidth: 7 },
      lineWithMarkers: { lineWidth: 4 },
      area: { lineWidth: 1.5 },
      baseline: { baseLevel: 101 },
      stepLine: { priceSource: 'median' },
      mystery: { lineWidth: 2 },
    },
  });

  expect(layer).toEqual({
    barStyles: {
      candles: { colorByPreviousClose: true },
      lineWithMarkers: { lineWidth: 4 },
    },
  });
});

test('a stored layer that is not an object reads as no layer', () => {
  for (const raw of ['x', null, [], 42]) {
    expect(readChartSettingsLayer(raw)).toEqual({});
  }
});

test('settings equal to the defaults have no overrides', () => {
  expect(chartSettingsOverrides(DEFAULT_CHART_SETTINGS, DEFAULT_CHART_SETTINGS)).toEqual({});
});

test('an edit and a time zone change round-trip through one sparse layer', () => {
  const hiddenWick = { visible: false, up: '#26a69a', down: '#f7525f' };
  const edited = withTimeZone(withSettingValue(DEFAULT_CHART_SETTINGS, 'candles', 'wick', hiddenWick), 'UTC');

  const overrides = chartSettingsOverrides(DEFAULT_CHART_SETTINGS, edited);

  expect(overrides).toEqual({
    timeZone: 'UTC',
    barStyles: { candles: { wick: { visible: false, up: '#26a69a', down: '#f7525f' } } },
  });
  expect(resolveChartSettings([overrides])).toEqual(edited);
});

test('every bar style declares at least one field with unique keys', () => {
  for (const style of BAR_STYLES) {
    const section = BAR_STYLE_SETTINGS[style];
    const keys = section.fields.map((field) => field.key);

    expect(section.title).toBe(barStyleLabel(style));
    expect(section.fields.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  }
});

test('the dialog groups list every bar style exactly once', () => {
  const groupedStyles = BAR_STYLE_GROUPS.flat().map((option) => option.style);

  expect(groupedStyles.sort()).toEqual([...BAR_STYLES].sort());
  expect(isBarStyle('candles')).toBe(true);
  expect(isBarStyle('renko')).toBe(false);
});

/** How the chart looks today, which is what every canvas field defaults to. */
const CANVAS_DEFAULTS: Readonly<Record<string, unknown>> = {
  background: { mode: 'solid', color: palette.overlay, bottomColor: palette.overlay },
  verticalGrid: { visible: true, color: palette.borderSubtle, style: 'solid' },
  horizontalGrid: { visible: true, color: palette.borderSubtle, style: 'solid' },
  crosshair: { color: palette.textLabel, style: 'solid' },
  scaleText: { color: palette.mutedStrong, fontSize: 11 },
  scaleLines: palette.border,
  topMargin: 12,
  bottomMargin: 18,
  rightMargin: 5,
};

test('every canvas field defaults to the way the chart looks today', () => {
  expect(DEFAULT_CHART_SETTINGS.canvas).toEqual(CANVAS_DEFAULTS);
  for (const field of canvasFields()) {
    expect(field.defaultValue).toEqual(CANVAS_DEFAULTS[field.key]);
  }
});

test('the canvas settings are drawn in the three sections the dialog lists, in order', () => {
  expect(CANVAS_SETTINGS.map((section) => section.title)).toEqual(['Chart basic styles', 'Scales', 'Margins']);
  expect(canvasFields().map((field) => field.key)).toEqual(Object.keys(CANVAS_DEFAULTS));
});

test('a chart canvas override wins per field over the template it starts from', () => {
  const templateLayer = readChartSettingsLayer({
    canvas: { topMargin: 20, crosshair: { color: palette.info, style: 'dashed' } },
  });
  const overrideLayer = readChartSettingsLayer({ canvas: { topMargin: 30, rightMargin: 12 } });

  const resolved = resolveChartSettings([templateLayer, overrideLayer]);

  expect(resolved.canvas.topMargin).toBe(30);
  expect(resolved.canvas.rightMargin).toBe(12);
  expect(resolved.canvas.crosshair).toEqual({ color: palette.info, style: 'dashed' });
  expect(resolved.canvas.bottomMargin).toBe(18);
  expect(resolved.canvas.background).toEqual(CANVAS_DEFAULTS.background);
});

test('a stored canvas layer keeps the fields it can read and drops the rest', () => {
  const layer = readChartSettingsLayer({
    canvas: {
      background: { mode: 'radial', color: palette.overlay, bottomColor: palette.overlay },
      verticalGrid: { visible: false, color: 'nope', style: 'solid' },
      horizontalGrid: { visible: false, color: palette.borderSubtle, style: 'solid' },
      crosshair: { color: palette.textLabel, style: 'wavy' },
      scaleText: { color: palette.mutedStrong, fontSize: 9 },
      rightMargin: 51,
      topMargin: 20,
      unknownField: 3,
    },
  });

  expect(layer).toEqual({
    canvas: { horizontalGrid: { visible: false, color: palette.borderSubtle, style: 'solid' }, topMargin: 20 },
  });
});

test('a stored layer whose margins leave the bars no height drops its canvas settings', () => {
  const layer = readChartSettingsLayer({ timeZone: 'UTC', canvas: { topMargin: 60, bottomMargin: 40 } });

  expect(layer).toEqual({ timeZone: 'UTC' });
});

test('a canvas edit round-trips through one sparse layer', () => {
  const edited = withCanvasValue(DEFAULT_CHART_SETTINGS, 'rightMargin', 3);

  const overrides = chartSettingsOverrides(DEFAULT_CHART_SETTINGS, edited);

  expect(overrides).toEqual({ canvas: { rightMargin: 3 } });
  expect(resolveChartSettings([overrides])).toEqual(edited);
});
