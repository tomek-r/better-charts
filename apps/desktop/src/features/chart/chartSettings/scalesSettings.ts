import { palette } from '../../../shared/theme/palette';
import {
  PRICE_SCALE_MODES,
  SCALE_BUTTON_MODES,
  type ChartPriceScaleMode,
  type ScaleButtonsMode,
} from '../engine/surface/chartScalesAppearance';
import {
  CHART_DATE_FORMATS,
  CHART_HOUR_FORMATS,
  type ChartDateFormat,
  type ChartHourFormat,
} from '../timeZone/chartTimeFormat';
import type {
  ChartSettingField,
  CheckboxSettingField,
  ChoiceSettingField,
  QuoteLinesSettingField,
  SettingsSectionFields,
} from './settingFields';

type ScalesSettingsSection = SettingsSectionFields;

const SCALE_MODE_LABELS: Readonly<Record<ScaleButtonsMode, string>> = {
  mouseOver: 'Visible on mouse over',
  always: 'Always visible',
  hidden: 'Hidden',
};

const SCALE_MODE_BUTTONS_FIELD: ChoiceSettingField = {
  kind: 'choice',
  key: 'scaleModeButtons',
  label: 'Scale modes (A and L)',
  defaultValue: 'mouseOver',
  options: SCALE_BUTTON_MODES.map((mode) => ({ value: mode, label: SCALE_MODE_LABELS[mode] })),
};

const COUNTDOWN_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: 'countdown',
  label: 'Countdown to bar close',
  defaultValue: true,
};

// The bid line is the red the trading rows draw a sell in, and the ask line the teal they draw a buy in.
const BID_ASK_FIELD: QuoteLinesSettingField = {
  kind: 'quoteLines',
  key: 'bidAsk',
  label: 'Bid and ask',
  defaultValue: { mode: 'lineAndLabel', bid: palette.sell, ask: palette.buy },
};

// The pointer label writes the weekday today, so the labels the app writes start with it on.
const DAY_OF_WEEK_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: 'dayOfWeek',
  label: 'Day of week on labels',
  defaultValue: true,
};

const DATE_FORMAT_LABELS: Readonly<Record<ChartDateFormat, string>> = {
  dayMonthYear: "29 Sep '97",
  dayMonthNumeric: '29/09/97',
  monthDayNumeric: '09/29/97',
  iso: '1997-09-29',
};

const DATE_FORMAT_FIELD: ChoiceSettingField = {
  kind: 'choice',
  key: 'dateFormat',
  label: 'Date format',
  defaultValue: 'dayMonthYear',
  options: CHART_DATE_FORMATS.map((format) => ({ value: format, label: DATE_FORMAT_LABELS[format] })),
};

const HOUR_FORMAT_LABELS: Readonly<Record<ChartHourFormat, string>> = { h24: '24-hours', h12: '12-hours' };

const HOUR_FORMAT_FIELD: ChoiceSettingField = {
  kind: 'choice',
  key: 'hourFormat',
  label: 'Time hours format',
  defaultValue: 'h24',
  options: CHART_HOUR_FORMATS.map((format) => ({ value: format, label: HOUR_FORMAT_LABELS[format] })),
};

const PRICE_SCALE_FIELDS: readonly ChartSettingField[] = [SCALE_MODE_BUTTONS_FIELD];

const PRICE_LABELS_FIELDS: readonly ChartSettingField[] = [COUNTDOWN_FIELD, BID_ASK_FIELD];

const TIME_SCALE_FIELDS: readonly ChartSettingField[] = [DAY_OF_WEEK_FIELD, DATE_FORMAT_FIELD, HOUR_FORMAT_FIELD];

/** What the Scales and lines tab draws: the price scale, the labels and lines it draws, and the time scale. */
export const SCALES_SETTINGS: readonly ScalesSettingsSection[] = [
  { title: 'Price scale', fields: PRICE_SCALE_FIELDS },
  { title: 'Price labels & lines', fields: PRICE_LABELS_FIELDS },
  { title: 'Time scale', fields: TIME_SCALE_FIELDS },
];

const PRICE_SCALE_MODE_LABELS: Readonly<Record<ChartPriceScaleMode, string>> = {
  regular: 'Regular',
  logarithmic: 'Logarithmic',
};

const PRICE_SCALE_MODE_FIELD: ChoiceSettingField = {
  kind: 'choice',
  key: 'priceScaleMode',
  label: 'Scale type',
  defaultValue: 'regular',
  options: PRICE_SCALE_MODES.map((mode) => ({ value: mode, label: PRICE_SCALE_MODE_LABELS[mode] })),
};

const INVERT_SCALE_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: 'invertScale',
  label: 'Invert scale',
  defaultValue: false,
};

const SYMBOL_NAME_LABEL_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: 'symbolNameLabel',
  label: 'Symbol name label',
  defaultValue: false,
};

/**
 * The price scale's shape and the symbol tag: saved with the scales settings, like the rows above, but
 * offered only by the gear's Scales and lines menu, never by the dialog's Scales and lines tab.
 */
export const SCALES_AND_LINES_MENU_FIELDS: readonly ChartSettingField[] = [
  PRICE_SCALE_MODE_FIELD,
  INVERT_SCALE_FIELD,
  SYMBOL_NAME_LABEL_FIELD,
];

/** Every scales field storage reads and writes: the sections the dialog draws, then the gear menu's fields. */
export function scalesFields(): readonly ChartSettingField[] {
  return [...SCALES_SETTINGS.flatMap((section) => section.fields), ...SCALES_AND_LINES_MENU_FIELDS];
}
