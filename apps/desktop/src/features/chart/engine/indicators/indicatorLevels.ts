import { LineStyle, type IPriceLine, type ISeriesApi } from 'lightweight-charts';
import type { IndicatorLevel, IndicatorLineStyle } from './indicatorFrame';
import { toLineWidth } from './indicatorLineWidth';

/** The library style of each indicator style; the indicator format has the three the display needs. */
const LIBRARY_LINE_STYLES: Record<IndicatorLineStyle, LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
};

/** The library's stroke style for a plot's or a level's style; a missing style is solid. */
export function toLibraryLineStyle(style?: IndicatorLineStyle): LineStyle {
  return style === undefined ? LineStyle.Solid : LIBRARY_LINE_STYLES[style];
}

/** The indicator style behind a library stroke, for reading a drawn line back; the wider dashes fold into their family. */
export function toIndicatorLineStyle(style: LineStyle): IndicatorLineStyle {
  if (style === LineStyle.Dotted || style === LineStyle.SparseDotted) {
    return 'dotted';
  }
  if (style === LineStyle.Dashed || style === LineStyle.LargeDashed) {
    return 'dashed';
  }
  return 'solid';
}

/** Draws `levels` as price lines on `series`, each one exactly as its level describes it. */
export function createLevelLines(series: ISeriesApi<'Line'>, levels: readonly IndicatorLevel[]): IPriceLine[] {
  return levels.map((level) =>
    series.createPriceLine({
      price: level.price,
      color: level.color,
      lineWidth: toLineWidth(level.lineWidth),
      lineStyle: toLibraryLineStyle(level.lineStyle),
      lineVisible: level.visible !== false,
      axisLabelVisible: false,
      title: '',
    }),
  );
}

/** Shows or hides every level line, keeping the levels that are switched off themselves switched off. */
export function setLevelLinesHidden(
  lines: readonly IPriceLine[],
  levels: readonly IndicatorLevel[],
  hidden: boolean,
): void {
  for (const [lineIndex, line] of lines.entries()) {
    line.applyOptions({ lineVisible: !hidden && levels[lineIndex]?.visible !== false });
  }
}

/** Removes level lines from the series that drew them. */
export function removeLevelLines(series: ISeriesApi<'Line'>, lines: readonly IPriceLine[]): void {
  for (const line of lines) {
    series.removePriceLine(line);
  }
}
