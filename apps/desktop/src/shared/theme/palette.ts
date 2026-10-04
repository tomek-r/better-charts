/**
 * Canvas palette: the chart engine paints onto a canvas, which cannot read CSS
 * custom properties, so these values mirror `src/styles/tokens.css`.
 *
 * Keep the two in sync: change a colour in tokens.css and here in one commit.
 * The e2e suite asserts the TradingView-parity overlay values in
 * `e2e/fixed-range-profile.spec.ts`, so those four are pinned.
 */
export const palette = {
  root: '#0b0e14',
  well: '#040608',
  surface: '#0d121b',
  panel: '#121923',
  raised: '#1a2637',
  overlay: '#121823e8',

  borderSubtle: '#1d2635',
  border: '#2b384b',
  borderStrong: '#3b4b62',

  text: '#e8edf5',
  textBright: '#f2f5fa',
  textSecondary: '#dce4ef',
  textTertiary: '#c4c9d0',
  textLabel: '#a4b7d0',
  muted: '#718099',
  mutedStrong: '#8b99ad',

  accent: '#6de0ac',
  accentSoft: '#91e2bd',
  accentFill: '#17382e',

  buy: '#26a69a',
  sell: '#f7525f',
  sellSoft: '#ff7185',
  dangerText: '#ffadb3',

  warn: '#ff9800',
  warnText: '#ffd28a',

  up: '#26a69a',
  tp: '#3aaeff',
  upWash: '#26a69a55',
  sellWash: '#f7525f55',

  profilePoc: '#ffd200',
} as const;
