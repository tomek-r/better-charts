import { ColorType, LineStyle, type Background, type GridLineOptions } from 'lightweight-charts';
import type { LineDashKind } from '../../../../shared/canvas/dashPatterns';
import { palette } from '../../../../shared/theme/palette';
import { CHART_FONT_SIZE } from './chartFont';

/** A line the chart paints: its colour and the dash it is drawn in. */
export interface ChartLineAppearance {
  readonly color: string;
  readonly style: LineDashKind;
}

/** A line the chart paints at a thickness the settings set, such as the pointer's crosshair. */
export interface ChartSizedLineAppearance extends ChartLineAppearance {
  /** The line's thickness in CSS px. */
  readonly width: number;
}

/** A line a settings checkbox shows and hides, such as a grid line. */
export interface ChartToggledLineAppearance extends ChartLineAppearance {
  readonly visible: boolean;
}

/**
 * The chart's background: one colour, or a gradient blended from its top colour down to its
 * bottom one. `color` is the gradient's top colour.
 */
export interface ChartBackgroundAppearance {
  readonly mode: 'solid' | 'gradient';
  readonly color: string;
  readonly bottomColor: string;
}

/** The numbers of a scale: their colour and their size in CSS px. */
export interface ChartScaleTextAppearance {
  readonly color: string;
  readonly fontSize: number;
}

/**
 * How the chart itself is painted, which is what the settings dialog's Canvas tab sets: the
 * background, both grids, the pointer's crosshair, the scales' text and lines, and the margins.
 */
export interface ChartAppearance {
  readonly background: ChartBackgroundAppearance;
  readonly verticalGrid: ChartToggledLineAppearance;
  readonly horizontalGrid: ChartToggledLineAppearance;
  readonly crosshair: ChartSizedLineAppearance;
  readonly scaleText: ChartScaleTextAppearance;
  /** The colour of the lines around both scales, price and time. */
  readonly scaleLines: string;
  /** Share of the pane's height the price fit leaves empty above the bars, in percent. */
  readonly topMarginPercent: number;
  /** Share of the pane's height the price fit leaves empty below the bars, in percent. */
  readonly bottomMarginPercent: number;
  /** Empty bars kept to the right of the last bar. */
  readonly rightMarginBars: number;
}

/** The chart as it is drawn today, which is what the settings start from. */
export const DEFAULT_CHART_APPEARANCE: ChartAppearance = {
  background: { mode: 'solid', color: palette.overlay, bottomColor: palette.overlay },
  verticalGrid: { visible: true, color: palette.borderSubtle, style: 'solid' },
  horizontalGrid: { visible: true, color: palette.borderSubtle, style: 'solid' },
  crosshair: { color: palette.textLabel, style: 'solid', width: 1 },
  scaleText: { color: palette.mutedStrong, fontSize: CHART_FONT_SIZE },
  scaleLines: palette.border,
  topMarginPercent: 12,
  bottomMarginPercent: 18,
  rightMarginBars: 5,
};

/** The chart options an appearance sets, in the shape `createChart` and `applyOptions` take. */
interface ChartAppearanceOptions {
  readonly layout: {
    readonly background: Background;
    readonly textColor: string;
    readonly fontSize: number;
  };
  readonly grid: {
    readonly vertLines: GridLineOptions;
    readonly horzLines: GridLineOptions;
  };
  readonly rightPriceScale: { readonly borderColor: string };
  readonly timeScale: { readonly borderColor: string };
}

const LINE_STYLE_BY_DASH: Readonly<Record<LineDashKind, LineStyle>> = {
  solid: LineStyle.Solid,
  // The owner's dash: 6 on, 6 off, the rhythm the canvas tools draw too.
  dashed: LineStyle.LargeDashed,
  dotted: LineStyle.Dotted,
};

const PERCENT = 100;

function backgroundOptions({ mode, color, bottomColor }: ChartBackgroundAppearance): Background {
  return mode === 'gradient'
    ? { type: ColorType.VerticalGradient, topColor: color, bottomColor }
    : { type: ColorType.Solid, color };
}

function gridLineOptions({ visible, color, style }: ChartToggledLineAppearance): GridLineOptions {
  return { visible, color, style: LINE_STYLE_BY_DASH[style] };
}

/** The chart options a whole appearance sets: background, scale text, both grids and both scale borders. */
export function chartLayoutOptions(appearance: ChartAppearance): ChartAppearanceOptions {
  return {
    layout: {
      background: backgroundOptions(appearance.background),
      textColor: appearance.scaleText.color,
      fontSize: appearance.scaleText.fontSize,
    },
    grid: {
      vertLines: gridLineOptions(appearance.verticalGrid),
      horzLines: gridLineOptions(appearance.horizontalGrid),
    },
    rightPriceScale: { borderColor: appearance.scaleLines },
    timeScale: { borderColor: appearance.scaleLines },
  };
}

/** The share of the pane the price fit leaves empty above and below the bars, as the library takes it. */
export function priceScaleMargins(appearance: ChartAppearance): { readonly top: number; readonly bottom: number } {
  return { top: appearance.topMarginPercent / PERCENT, bottom: appearance.bottomMarginPercent / PERCENT };
}

function sameLine(first: ChartLineAppearance, second: ChartLineAppearance): boolean {
  return first.color === second.color && first.style === second.style;
}

function sameToggledLine(first: ChartToggledLineAppearance, second: ChartToggledLineAppearance): boolean {
  return first.visible === second.visible && sameLine(first, second);
}

function sameSizedLine(first: ChartSizedLineAppearance, second: ChartSizedLineAppearance): boolean {
  return first.width === second.width && sameLine(first, second);
}

/** Whether two appearances paint the same chart, so one that did not change costs no re-layout. */
export function sameChartAppearance(first: ChartAppearance, second: ChartAppearance): boolean {
  return (
    first.background.mode === second.background.mode &&
    first.background.color === second.background.color &&
    first.background.bottomColor === second.background.bottomColor &&
    sameToggledLine(first.verticalGrid, second.verticalGrid) &&
    sameToggledLine(first.horizontalGrid, second.horizontalGrid) &&
    sameSizedLine(first.crosshair, second.crosshair) &&
    first.scaleText.color === second.scaleText.color &&
    first.scaleText.fontSize === second.scaleText.fontSize &&
    first.scaleLines === second.scaleLines &&
    first.topMarginPercent === second.topMarginPercent &&
    first.bottomMarginPercent === second.bottomMarginPercent &&
    first.rightMarginBars === second.rightMarginBars
  );
}
