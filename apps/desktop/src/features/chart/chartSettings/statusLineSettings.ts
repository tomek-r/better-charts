import {
  DEFAULT_STATUS_LINE_APPEARANCE,
  STATUS_LINE_TITLE_FORMATS,
  type StatusLineTitleFormat,
} from '../engine/legend/statusLineAppearance';
import type { ChartSettingField, CheckboxSettingField, SettingsSectionFields } from './settingFields';

const TITLE_FORMAT_LABELS: Record<StatusLineTitleFormat, string> = {
  name: 'Name',
  symbol: 'Symbol',
  symbolAndName: 'Symbol and name',
};

const TITLE_FORMAT_OPTIONS = STATUS_LINE_TITLE_FORMATS.map((value) => ({ value, label: TITLE_FORMAT_LABELS[value] }));

const INSTRUMENT_SECTION = 'Instrument';
const INDICATORS_SECTION = 'Indicators';

/** The Status line tab's rows; every default is the appearance the chart starts with. */
export const STATUS_LINE_SETTINGS: readonly SettingsSectionFields[] = [
  {
    title: INSTRUMENT_SECTION,
    fields: [
      {
        kind: 'checkbox',
        key: 'title',
        label: 'Title',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.title,
      },
      {
        kind: 'choice',
        key: 'titleFormat',
        label: 'Title format',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.titleFormat,
        options: TITLE_FORMAT_OPTIONS,
      },
      {
        kind: 'checkbox',
        key: 'marketStatus',
        label: 'Open market status',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.marketStatus,
      },
      {
        kind: 'checkbox',
        key: 'chartValues',
        label: 'Chart values',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.chartValues,
      },
      {
        kind: 'checkbox',
        key: 'barChange',
        label: 'Bar change values',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.barChange,
      },
      {
        kind: 'checkbox',
        key: 'volume',
        label: 'Volume',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.volume,
      },
      {
        kind: 'checkbox',
        key: 'lastDayChange',
        label: 'Last day change values',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.lastDayChange,
      },
    ],
  },
  {
    title: INDICATORS_SECTION,
    fields: [
      {
        kind: 'checkbox',
        key: 'indicatorTitles',
        label: 'Titles',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.indicatorTitles,
      },
      {
        kind: 'checkbox',
        key: 'indicatorInputs',
        label: 'Inputs',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.indicatorInputs,
      },
      {
        kind: 'checkbox',
        key: 'indicatorValues',
        label: 'Values',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.indicatorValues,
      },
      {
        kind: 'toggledColor',
        key: 'background',
        label: 'Background',
        defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.background,
      },
    ],
  },
];

/**
 * Whether the indicator rows are collapsed to their count: saved with the status line settings, like the
 * rows above, but the tab draws no row for it because the legend's own chevron is what edits it.
 */
const INDICATOR_LEGEND_COLLAPSED_FIELD: CheckboxSettingField = {
  kind: 'checkbox',
  key: 'indicatorLegendCollapsed',
  label: 'Indicator legend collapsed',
  defaultValue: DEFAULT_STATUS_LINE_APPEARANCE.indicatorLegendCollapsed,
};

/** Every status line field storage reads and writes: the rows the tab draws, then the chevron's own. */
export function statusLineFields(): ChartSettingField[] {
  return [...STATUS_LINE_SETTINGS.flatMap((section) => section.fields), INDICATOR_LEGEND_COLLAPSED_FIELD];
}
