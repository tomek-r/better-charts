export const BAR_STYLES = [
  'bars',
  'candles',
  'hollowCandles',
  'volumeCandles',
  'line',
  'lineWithMarkers',
  'stepLine',
  'area',
  'baseline',
  'columns',
  'highLow',
  'heikinAshi',
] as const;

export type BarStyle = (typeof BAR_STYLES)[number];

export const DEFAULT_BAR_STYLE: BarStyle = 'candles';

const BAR_STYLE_LABELS: Readonly<Record<BarStyle, string>> = {
  bars: 'Bars',
  candles: 'Candles',
  hollowCandles: 'Hollow candles',
  volumeCandles: 'Volume candles',
  line: 'Line',
  lineWithMarkers: 'Line with markers',
  stepLine: 'Step line',
  area: 'Area',
  baseline: 'Baseline',
  columns: 'Columns',
  highLow: 'High-low',
  heikinAshi: 'Heikin Ashi',
};

export interface BarStyleOption {
  readonly style: BarStyle;
  readonly label: string;
}

function barStyleOption(style: BarStyle): BarStyleOption {
  return { style, label: BAR_STYLE_LABELS[style] };
}

export const BAR_STYLE_GROUPS: readonly (readonly BarStyleOption[])[] = [
  [barStyleOption('bars'), barStyleOption('candles'), barStyleOption('hollowCandles'), barStyleOption('volumeCandles')],
  [barStyleOption('line'), barStyleOption('lineWithMarkers'), barStyleOption('stepLine')],
  [barStyleOption('area'), barStyleOption('baseline')],
  [barStyleOption('columns'), barStyleOption('highLow')],
  [barStyleOption('heikinAshi')],
];

export function isBarStyle(value: unknown): value is BarStyle {
  return BAR_STYLES.some((style) => style === value);
}

export function barStyleLabel(style: BarStyle): string {
  return BAR_STYLE_LABELS[style];
}
