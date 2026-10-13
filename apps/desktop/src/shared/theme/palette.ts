/**
 * The single source of truth for every colour in the app.
 *
 * Canvas code imports `palette` directly. CSS gets the same values as custom
 * properties from the `virtual:palette.css` module (`vite/paletteCss.ts`), which
 * turns each key into `--color-<kebab-case key>` (`warnBorderSoft` becomes
 * `--color-warn-border-soft`). Never define a `--color-*` variable in a
 * stylesheet; add the colour here instead (the guard in
 * `e2e/palette-css.spec.ts` enforces this).
 *
 * Palette rules (see docs/architecture/color-palette.md for the analysis):
 * - A colour earns a token only if no other token is within dE00 6 / dE76 12
 *   of it, except for deliberate aliases (buy == profile ask, sell == profile
 *   bid, buy == up, accent-soft == contest badge).
 * - Values asserted by e2e (`#f7525f`, `#26a69a`, `#ffd200`, `#f2f5fa`,
 *   `#c4c9d0`, `#121923`) are canonical for their family and never drift.
 */
export const palette = {
  // Neutrals: page, wells, surfaces, raised fills
  root: '#0b0e14',
  well: '#040608',
  surface: '#0d121b',
  panel: '#121923',
  raised: '#1a2637',
  overlay: '#121823e8',

  // Borders
  borderSubtle: '#1d2635',
  border: '#2b384b',
  borderStrong: '#3b4b62',
  borderDialog: '#374348',

  // Text
  text: '#e8edf5',
  textBright: '#f2f5fa',
  textSecondary: '#dce4ef',
  textTertiary: '#c4c9d0',
  textLabel: '#a4b7d0',
  muted: '#718099',
  mutedStrong: '#8b99ad',

  // Accent: confirmations, connected state, TP zone
  accent: '#6de0ac',
  accentSoft: '#91e2bd',
  accentFill: '#17382e',
  accentBorder: '#466b61',
  accentRing: '#6de0ac55',
  accentRingSoft: '#6de0ac1f',

  // Buy / long: teal (== up)
  buy: '#26a69a',
  buySoft: '#79d8cf',
  buyBorder: '#2a7d72',
  buyFill: '#143330',
  buyWash: '#0e2523',

  // Take profit and info / brand: blue
  tp: '#3aaeff',
  info: '#77a7ff',

  // Sell / danger: red
  sell: '#f7525f',
  sellSoft: '#ff7185',
  sellBorder: '#944b57',
  sellFill: '#45242b',
  sellFillTranslucent: '#45242bdd',
  sellWash: '#f7525f1c',
  sellWashStrong: '#f7525f55',
  sellRing: '#f7525f33',
  dangerText: '#ffadb3',

  // Warn: amber
  warn: '#ff9800',
  warnText: '#ffd28a',
  warnHighlight: '#e8c86c',
  warnBorder: '#94772b',
  warnBorderSoft: '#d9a441',
  warnFill: '#453a24',
  warnWash: '#ff98001c',
  warnWashFaint: '#ff980008',

  // Up / candle: teal
  up: '#26a69a',
  upWash: '#26a69a55',

  // Analysis overlays (TradingView-parity values, asserted by e2e)
  profilePoc: '#ffd200',

  // Scrims
  scrim: 'rgb(0 0 0 / 45%)',
  scrimStrong: '#0009',
} as const;

/** CSS custom-property name for a palette key: `warnBorderSoft` -> `--color-warn-border-soft`. */
export function paletteVariableName(key: string): string {
  return `--color-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}
