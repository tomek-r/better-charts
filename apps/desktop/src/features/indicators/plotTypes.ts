import type { IndicatorPlot, IndicatorPlotGaps, IndicatorPlotStyle } from '../chart/engine/indicators/indicatorFrame';
import type { SettingValues } from '../chart/engine/settings/settingInputs';
import type { SettingStyleChoice, SettingStyleToggle } from '../chart/engine/settings/settingStyles';
import { settingStyleKey } from '../chart/engine/settings/settingStyles';
import { booleanSetting, stringSetting } from './indicatorSettingValues';

// The Plot type and Price line styles every indicator plot can offer, whatever it draws. An indicator
// offers them by declaring `plotTypeStyle` and `priceLineStyle` among its styles and spreading
// `plotDrawingOf` into the plot it builds.

/** One way an indicator plot can be drawn, and what it does at a bar without a value. */
export interface PlotType {
  readonly value: string;
  readonly title: string;
  readonly style: IndicatorPlotStyle;
  readonly gaps: IndicatorPlotGaps;
}

/** Every way an indicator plot can be drawn, in the order the Plot type list shows them. */
export const PLOT_TYPES: readonly PlotType[] = [
  { value: 'line', title: 'Line', style: 'line', gaps: 'connect' },
  { value: 'lineBreaks', title: 'Line with breaks', style: 'line', gaps: 'break' },
  { value: 'step', title: 'Step line', style: 'stepline', gaps: 'connect' },
  { value: 'stepBreaks', title: 'Step line with breaks', style: 'stepline', gaps: 'break' },
  { value: 'stepDiamonds', title: 'Step line with diamonds', style: 'steplineDiamonds', gaps: 'connect' },
  { value: 'histogram', title: 'Histogram', style: 'stems', gaps: 'break' },
  { value: 'cross', title: 'Cross', style: 'crosses', gaps: 'break' },
  { value: 'area', title: 'Area', style: 'area', gaps: 'connect' },
  { value: 'areaBreaks', title: 'Area with breaks', style: 'area', gaps: 'break' },
  { value: 'columns', title: 'Columns', style: 'histogram', gaps: 'break' },
  { value: 'circles', title: 'Circles', style: 'circles', gaps: 'break' },
];

const PLOT_TYPE_TITLE = 'Plot type';
const PRICE_LINE_TITLE = 'Price line';
/** No plot draws a line at its last value until the user turns its Price line switch on. */
const PRICE_LINE_VISIBLE = false;

/** The Plot type choice an indicator plot offers, titled 'Plot type' unless the indicator titles it otherwise. */
export function plotTypeStyle(
  id: string,
  options: { title?: string; defaultType: string; parentId?: string },
): SettingStyleChoice {
  return {
    kind: 'choice',
    id,
    title: options.title ?? PLOT_TYPE_TITLE,
    parentId: options.parentId,
    defaultValue: options.defaultType,
    options: PLOT_TYPES.map((plotType) => ({ value: plotType.value, title: plotType.title })),
  };
}

/** The Price line switch an indicator plot can offer, off until the user turns it on. */
export function priceLineStyle(id: string, parentId?: string): SettingStyleToggle {
  return { kind: 'toggle', id, title: PRICE_LINE_TITLE, parentId, defaults: { visible: PRICE_LINE_VISIBLE } };
}

/** The entry `value` names, or nothing when the list has no such entry. */
function plotTypeNamed(value: string): PlotType | undefined {
  return PLOT_TYPES.find((plotType) => plotType.value === value);
}

/** The type to draw: the stored one, or the indicator's default when the stored text names no entry. */
function plotTypeOf(settings: SettingValues, styleId: string, defaultType: string): PlotType {
  const storedType = stringSetting(settings, styleId, defaultType);
  const plotType = plotTypeNamed(storedType) ?? plotTypeNamed(defaultType);
  if (plotType === undefined) {
    throw new Error(`Default plot type ${defaultType} is not one of PLOT_TYPES.`);
  }
  return plotType;
}

/**
 * The plot fields the Plot type and Price line styles describe: how the plot is drawn, what it does at
 * a bar without a value, and whether it draws a line at its last value. A stored type the list does not
 * know reads as `defaultType`.
 */
export function plotDrawingOf(
  settings: SettingValues,
  styleId: string,
  priceLineStyleId: string,
  defaultType: string,
): Pick<IndicatorPlot, 'style' | 'gaps' | 'priceLine'> {
  const plotType = plotTypeOf(settings, styleId, defaultType);
  return {
    style: plotType.style,
    gaps: plotType.gaps,
    priceLine: booleanSetting(settings, settingStyleKey(priceLineStyleId, 'visible'), PRICE_LINE_VISIBLE),
  };
}
