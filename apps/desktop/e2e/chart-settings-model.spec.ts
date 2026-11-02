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
  withScalesValue,
  withSettingValue,
  withTimeZone,
} from '../src/features/chart/chartSettings/chartSettings';
import { SCALES_SETTINGS, scalesFields } from '../src/features/chart/chartSettings/scalesSettings';
import type { QuoteLinesValue, SizedLineValue } from '../src/features/chart/chartSettings/settingFields';
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
  crosshair: { color: palette.textLabel, style: 'solid', width: 1 },
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
  // The crosshair is stored the way a build before the width existed stored it: two keys, no width.
  const templateLayer = readChartSettingsLayer({
    canvas: { topMargin: 20, crosshair: { color: palette.info, style: 'dashed' } },
  });
  const overrideLayer = readChartSettingsLayer({ canvas: { topMargin: 30, rightMargin: 12 } });

  const resolved = resolveChartSettings([templateLayer, overrideLayer]);

  expect(resolved.canvas.topMargin).toBe(30);
  expect(resolved.canvas.rightMargin).toBe(12);
  expect(resolved.canvas.crosshair).toEqual({ color: palette.info, style: 'dashed', width: 1 });
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

test('the crosshair is the one canvas line whose thickness the settings set', () => {
  const kindByKey = new Map(canvasFields().map((field) => [field.key, field.kind]));

  expect(kindByKey.get('crosshair')).toBe('sizedLine');
  expect(kindByKey.get('verticalGrid')).toBe('toggledLine');
  expect(kindByKey.get('horizontalGrid')).toBe('toggledLine');
});

test('a crosshair stored before it had a width keeps its colour and dash, one pixel wide', () => {
  const layer = readChartSettingsLayer({ canvas: { crosshair: { color: palette.info, style: 'dashed' } } });

  expect(layer).toEqual({ canvas: { crosshair: { color: palette.info, style: 'dashed', width: 1 } } });
});

test('a stored crosshair whose width is not one of the four is dropped', () => {
  for (const width of [5, 1.5, 0]) {
    const layer = readChartSettingsLayer({
      canvas: { crosshair: { color: palette.textLabel, style: 'solid', width } },
    });

    expect(layer).toEqual({});
  }
});

test('a crosshair thickness edit round-trips through one sparse layer', () => {
  const crosshair: SizedLineValue = { color: palette.textLabel, style: 'solid', width: 2 };
  const edited = withCanvasValue(DEFAULT_CHART_SETTINGS, 'crosshair', crosshair);

  const overrides = chartSettingsOverrides(DEFAULT_CHART_SETTINGS, edited);

  expect(overrides).toEqual({ canvas: { crosshair } });
  expect(resolveChartSettings([overrides])).toEqual(edited);
});

/** How the chart's scales and lines behave today, which is what every scales field defaults to. */
const SCALES_DEFAULTS: Readonly<Record<string, unknown>> = {
  scaleModeButtons: 'mouseOver',
  countdown: true,
  bidAsk: { mode: 'lineAndLabel', bid: palette.sell, ask: palette.buy },
  dayOfWeek: true,
  dateFormat: 'dayMonthYear',
  hourFormat: 'h24',
};

/** The bid and ask with nothing drawn of them, as the dialog's Hidden option writes them. */
const HIDDEN_QUOTES: QuoteLinesValue = { mode: 'hidden', bid: palette.sell, ask: palette.buy };

test('every scales field defaults to the way the chart behaves today', () => {
  expect(DEFAULT_CHART_SETTINGS.scales).toEqual(SCALES_DEFAULTS);
  for (const field of scalesFields()) {
    expect(field.defaultValue).toEqual(SCALES_DEFAULTS[field.key]);
  }
});

test('the scales settings are drawn in the three sections the dialog lists, in order', () => {
  expect(SCALES_SETTINGS.map((section) => section.title)).toEqual([
    'Price scale',
    'Price labels & lines',
    'Time scale',
  ]);
  expect(scalesFields().map((field) => field.key)).toEqual(Object.keys(SCALES_DEFAULTS));
});

test('a chart scales override wins per field over the template it starts from', () => {
  const templateLayer = readChartSettingsLayer({
    scales: { scaleModeButtons: 'always', countdown: false, dateFormat: 'iso', hourFormat: 'h12' },
  });
  const overrideLayer = readChartSettingsLayer({ scales: { countdown: true, hourFormat: 'h24', dayOfWeek: true } });

  const resolved = resolveChartSettings([templateLayer, overrideLayer]);

  expect(resolved.scales).toEqual({
    scaleModeButtons: 'always',
    countdown: true,
    bidAsk: SCALES_DEFAULTS.bidAsk,
    dayOfWeek: true,
    dateFormat: 'iso',
    hourFormat: 'h24',
  });
});

test('a stored scales layer keeps the fields it can read and drops the rest', () => {
  const layer = readChartSettingsLayer({
    scales: {
      scaleModeButtons: 'sometimes',
      countdown: false,
      bidAsk: { mode: 'blink', bid: palette.sell, ask: palette.buy },
      dayOfWeek: true,
      dateFormat: 'julian',
      hourFormat: 'h36',
      unknownField: 3,
    },
  });

  expect(layer).toEqual({ scales: { countdown: false, dayOfWeek: true } });
});

test('a stored bid and ask whose colour is not a colour is dropped whole', () => {
  const layer = readChartSettingsLayer({ scales: { bidAsk: { mode: 'line', bid: 'nope', ask: palette.buy } } });

  expect(layer).toEqual({});
});

test('a scales edit round-trips through one sparse layer', () => {
  const edited = withScalesValue(DEFAULT_CHART_SETTINGS, 'countdown', false);

  const overrides = chartSettingsOverrides(DEFAULT_CHART_SETTINGS, edited);

  expect(overrides).toEqual({ scales: { countdown: false } });
  expect(resolveChartSettings([overrides])).toEqual(edited);
});

test('a bid and ask edit round-trips through one sparse layer', () => {
  const edited = withScalesValue(DEFAULT_CHART_SETTINGS, 'bidAsk', HIDDEN_QUOTES);

  const overrides = chartSettingsOverrides(DEFAULT_CHART_SETTINGS, edited);

  expect(overrides).toEqual({ scales: { bidAsk: HIDDEN_QUOTES } });
  expect(resolveChartSettings([overrides])).toEqual(edited);
});
