import { palette } from '../../../shared/theme/palette';
import type {
  BackgroundFillSettingField,
  BarCountSettingField,
  ChartSettingField,
  ColorSettingField,
  LineSettingField,
  PercentSettingField,
  SettingsSectionFields,
  TextStyleSettingField,
  ToggledLineSettingField,
} from './settingFields';

export type CanvasSettingsSection = SettingsSectionFields;

const BACKGROUND_FIELD: BackgroundFillSettingField = {
  kind: 'backgroundFill',
  key: 'background',
  label: 'Background',
  defaultValue: { mode: 'solid', color: palette.overlay, bottomColor: palette.overlay },
};

const VERTICAL_GRID_FIELD: ToggledLineSettingField = {
  kind: 'toggledLine',
  key: 'verticalGrid',
  label: 'Vertical grid lines',
  defaultValue: { visible: true, color: palette.borderSubtle, style: 'solid' },
};

const HORIZONTAL_GRID_FIELD: ToggledLineSettingField = {
  kind: 'toggledLine',
  key: 'horizontalGrid',
  label: 'Horizontal grid lines',
  defaultValue: { visible: true, color: palette.borderSubtle, style: 'solid' },
};

const CROSSHAIR_FIELD: LineSettingField = {
  kind: 'line',
  key: 'crosshair',
  label: 'Crosshair',
  defaultValue: { color: palette.textLabel, style: 'solid' },
};

const SCALE_TEXT_FIELD: TextStyleSettingField = {
  kind: 'textStyle',
  key: 'scaleText',
  label: 'Text',
  defaultValue: { color: palette.mutedStrong, fontSize: 11 },
};

const SCALE_LINES_FIELD: ColorSettingField = {
  kind: 'color',
  key: 'scaleLines',
  label: 'Lines',
  defaultValue: palette.border,
};

const TOP_MARGIN_FIELD: PercentSettingField = {
  kind: 'percent',
  key: 'topMargin',
  label: 'Top',
  defaultValue: 12,
  unit: '%',
};

const BOTTOM_MARGIN_FIELD: PercentSettingField = {
  kind: 'percent',
  key: 'bottomMargin',
  label: 'Bottom',
  defaultValue: 18,
  unit: '%',
};

const RIGHT_MARGIN_FIELD: BarCountSettingField = {
  kind: 'barCount',
  key: 'rightMargin',
  label: 'Right',
  defaultValue: 5,
  unit: 'bars',
};

const CHART_BASIC_FIELDS: readonly ChartSettingField[] = [
  BACKGROUND_FIELD,
  VERTICAL_GRID_FIELD,
  HORIZONTAL_GRID_FIELD,
  CROSSHAIR_FIELD,
];

const SCALES_FIELDS: readonly ChartSettingField[] = [SCALE_TEXT_FIELD, SCALE_LINES_FIELD];

const MARGIN_FIELDS: readonly ChartSettingField[] = [TOP_MARGIN_FIELD, BOTTOM_MARGIN_FIELD, RIGHT_MARGIN_FIELD];

/** What the Canvas tab draws: the chart's own colours, grid lines, text and margins, in the dialog's order. */
export const CANVAS_SETTINGS: readonly CanvasSettingsSection[] = [
  { title: 'Chart basic styles', fields: CHART_BASIC_FIELDS },
  { title: 'Scales', fields: SCALES_FIELDS },
  { title: 'Margins', fields: MARGIN_FIELDS },
];

/** Every canvas field, the section boundaries dropped, in the order the dialog draws them. */
export function canvasFields(): readonly ChartSettingField[] {
  return CANVAS_SETTINGS.flatMap((section) => section.fields);
}
