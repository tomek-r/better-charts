export const STATUS_LINE_TITLE_FORMATS = ['name', 'symbol', 'symbolAndName'] as const;

export type StatusLineTitleFormat = (typeof STATUS_LINE_TITLE_FORMATS)[number];

export interface ChartStatusLineAppearance {
  readonly title: boolean;
  readonly titleFormat: StatusLineTitleFormat;
  readonly marketStatus: boolean;
  readonly chartValues: boolean;
  readonly barChange: boolean;
  readonly volume: boolean;
  readonly lastDayChange: boolean;
  readonly indicatorTitles: boolean;
  readonly indicatorInputs: boolean;
  readonly indicatorValues: boolean;
  /** Whether the indicator rows are collapsed to their count, as the legend's chevron last set. */
  readonly indicatorLegendCollapsed: boolean;
  readonly background: { visible: boolean; color: string };
}

export const DEFAULT_STATUS_LINE_APPEARANCE: ChartStatusLineAppearance = {
  title: true,
  titleFormat: 'symbol',
  marketStatus: true,
  chartValues: true,
  barChange: true,
  volume: true,
  lastDayChange: true,
  indicatorTitles: true,
  indicatorInputs: true,
  indicatorValues: true,
  indicatorLegendCollapsed: false,
  background: { visible: false, color: '#131722B3' },
};

export function statusLineTitle(
  format: StatusLineTitleFormat,
  symbol: string,
  description: string | undefined,
): string {
  if (format === 'name') {
    return description ?? symbol;
  }
  if (format === 'symbolAndName') {
    return description === undefined ? symbol : `${symbol} · ${description}`;
  }
  return symbol;
}
