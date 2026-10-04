# Color conventions

The source of truth is
[`tokens.css`](../../apps/desktop/src/styles/tokens.css). Canvas rendering uses
[`palette.ts`](../../apps/desktop/src/shared/theme/palette.ts); update both
together. The pre-paint background in `index.html` must match `--color-root`.

Use existing tokens for surfaces, borders, text and semantic states. Add a
color only when no existing token is within both ΔE00 < 6 and ΔE76 < 12, unless
the roles require a deliberate distinction. Preserve surface/border contrast
and separate alpha variants for washes, rings and scrims.

| Role | Canonical value |
| --- | --- |
| Buy, up candles, profile ASK | `#26a69a` |
| Sell, down candles, profile BID | `#f7525f` |
| Profile POC | `#ffd200` |
| Profile value-area lines | `#f2f5fa` |
| Dialog body text | `#c4c9d0` |
| Panel and plot background | `#121923` |

These values are independently asserted by E2E tests. Keep the green UI accent
separate from buy/candle teal, take-profit blue separate from stop-loss amber,
and dialog borders separate from ordinary control borders. Color changes that
affect these roles require reviewing the corresponding visual regressions.
