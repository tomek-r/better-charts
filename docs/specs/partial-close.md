# Partial close

Status: implemented on `feat/partial-close`, 2026-10-10. UI mockup:
<https://claude.ai/artifact/FTXYyKmJMc6MGhnuUHDSEZ> (private to the owner).

Close part of an open position now, from the portfolio card or the chart.

Partial take profit is out of scope: MT5 has no partial TP. Activating TP or
SL "results in the complete closing of the entire position", and
`TRADE_ACTION_SLTP` carries no volume
([MT5 trading concepts](https://www.metatrader5.com/en/terminal/help/trading/general_concept),
[MqlTradeRequest](https://www.mql5.com/en/docs/constants/structures/mqltraderequest)).
A partial TP would have to be triggered by the app or the EA, so it would only
work while they run. It was dropped.

## Terms

- **Position volume (V)**: current volume of the position, in units.
- **Min volume (m)** and **volume step (s)**: the symbol's `SYMBOL_VOLUME_MIN` and
  `SYMBOL_VOLUME_STEP`, sent per position as `volume_min` / `volume_step`.

All volume math is exact: `Decimal` in `trading-core`, string/BigInt
arithmetic in the frontend. Never `f32`/`f64` or JavaScript numbers.

## Design system

New UI follows the app's existing design system. The mockup illustrates layout
and behaviour only; where its colours or styles differ from the app, the app
wins.

- **Colours** come from the existing tokens in
  `apps/desktop/src/styles/tokens.css`; canvas drawing (chart chips) uses the
  matching values in `apps/desktop/src/shared/theme/palette.ts`. Follow
  [color conventions](../architecture/color-palette.md): reuse a token unless
  none is within ΔE00 < 6 and ΔE76 < 12, and update `tokens.css` and
  `palette.ts` together when a new one is genuinely needed.
- **Roles keep their established colours**: buy/sell teal and red keep their
  meaning and are not reused for neutral UI.
- **Typography, spacing, radii and borders** match the surrounding components:
  the portfolio card (`features/portfolio/portfolio.css`), the order-ticket
  menus (`features/order-ticket/order-ticket.css`) and the chart overlay
  labels. The UI font is used throughout, with tabular digits for volumes.
- **Existing components are reused**: `CaretIcon` for **▾**, the shared
  notification and error-text styles, the neutral `.action-button` class
  (`shared/ui/action-button.css`) and the existing menu styles.
- **Volumes are displayed with one shared formatter** (`formatVolume` in
  `shared/format.ts`), which strips trailing zeros exactly: the EA's
  `"0.05000000"` displays as `0.05` everywhere (portfolio row, chart chip,
  partial-close UI).
- **Agreed styling decisions** (from the mockup review):
  - the popover's confirm button is neutral, not red, and its text is always
    `Close`;
  - the close/keep bar uses neutral greys, not semantic colours;
  - bar labels use the UI font, not monospace: `Close 0.3`, `Keep 0.7`;
  - no drop shadows;
  - no extra state decoration: no coloured row border while waiting, and no
    `closing…` or `closed` badges;
  - messages are positioned absolutely so they never push content down;
  - copy is short: no P/L estimate line, no summary sentence, no volume-step hint
    in menus;
  - menus and popovers stay inside the narrow drawer and the chart frame.
- **Accessibility**: menus use `role="menu"`/`menuitem` with arrow keys, the
  menu and popover dismiss with Escape and outside press, controls have
  visible focus, and errors use `role="alert"`.
- **Owner-decision UI copy and layout** listed in `docs/CURRENT_STATE.md`
  stay unchanged unless the owner approves; check the related E2E tests before
  changing any existing chart or panel behaviour.

## When it is offered

Partial close is available for a position when all hold:

- the connected EA negotiated the `partial_close` capability;
- the position carries `volume_min` and `volume_step`;
- a valid split exists: `V ≥ 2m`.

Otherwise the portfolio card shows a plain **Close** button and the chart chip
shows only **✕**. Nothing is shown disabled; the option does not exist for
that position.

## Valid volumes

A partial close volume `v` is valid when all hold:

- `m ≤ v ≤ V`;
- `v` is a multiple of `s`;
- the remainder `V − v` is `0` or `≥ m`.

`v = V` is a full close and is sent as `volume: null`. Presets are
percentages of the **current** position volume, rounded **down** to `s`; a
preset whose value is not a valid partial volume is not shown.

## Portfolio card

```
[ Close | ▾ ]
```

- **Close**: full close, unchanged.
- **▾** opens a menu, aligned to the ▾'s right edge so it opens leftward:
  - `Close 25%  0.25 units`, `Close 50%  0.5 units`, `Close 75%  0.75 units` (real,
    rounded sizes for this position);
  - `Custom volume…`.
- Choosing a preset sends the close immediately with the preset volume, the
  same way **Close** sends a full close today (no confirmation dialog).

## Custom volume popover

Opens from `Custom volume…` as an overlay anchored below the row, as wide as the
row. It does not push the following rows down; for the last row it extends the
drawer's scroll area and is scrolled into view.

- Header: `Close part of {SYMBOL} {SIDE}` on the left, **✕** (dismiss) on the
  right.
- Volume input with **−** / **+** buttons that step by `s`, followed by
  `of {V} units`. Typed values snap down to `s` on blur; a comma decimal
  separator is accepted. The input starts at the 50% preset, or at `m` when
  that preset is hidden.
- Shortcut chips: `25%`, `50%`, `75%`, `All`. `All` fills `V`; confirming it
  performs a full close.
- A bar split into **close** (light neutral) and **keep** (dark neutral), with
  labels `Close {v}` and `Keep {V − v}` below it. The bar is a draggable
  slider (native range input, `aria-label="Close volume"`, `aria-valuetext`
  `Close {v} of {V} units`) synced both ways with the input, stepper and chips.
  It snaps to `s` within `m … V`; a remainder in (0, `m`) is never selectable
  (it snaps to `V − m` or `V`). Arrow keys move one step, Home/End go to `m`/`V`.
- Inline error under the bar when the value is invalid:
  - below `m`: `Enter at least {m} units.`
  - above `V`: `The position is only {V} units.`
  - remainder below `m`: `The amount left would be below the {m} units minimum.
    Close all instead.`
- Buttons: **Cancel** and **Close**. **Close** uses the neutral button style,
  keeps the text `Close` for every volume, and is disabled while the value is
  invalid.
- While the popover is open, the row's main **Close** is disabled (tooltip:
  `Finish or cancel the partial close first`). **Cancel**, **✕** and Escape
  close the popover and re-enable it.

## Chart position chip

```
✕ | ▾ | P&L -5.11 USD · 0.1 units · RR 1.10
```

- **✕** left click: full close, unchanged.
- **▾** opens the same preset menu, anchored below the chip and clamped inside
  the chart frame. Right-clicking **✕** opens the same menu; a right-button
  press on a position chip never closes the position.
- `Custom volume…` opens the same popover. While it is open, **✕** does
  nothing, matching the portfolio card.
- When partial close is not available, **▾** is not painted and the chip
  layout is exactly as before. When it is, the P&L box shifts right by the ▾
  width.

## After sending

- **Waiting for MT5**: the row's buttons show `Closing…` and are disabled.
  Other close/cancel actions stay locked by the existing one-in-flight rule.
  Nothing updates optimistically.
- **Filled**: the position shows its new volume; SL and TP are unchanged
  (MT5: "If a position is partially closed, Stop Loss and Take Profit are not
  changed"). Success is silent, like full close (owner decision in
  `features/execution/useExecutionCommands.ts`).
- **Rejected**: the position is unchanged and the existing error notification
  shows the reason.

## Execution and protocol

- `order_close_request.volume` (`docs/protocol/bridge-v1.md`): `null` = full
  close (unchanged); a positive decimal string = partial close of that volume.
- **Capability gate (safety-critical).** An EA that ignores `volume` performs a
  **full** close. The `partial_close` capability is negotiated in
  `hello`/`hello_ack` (default `false`) and exposed as `partialClose` on the
  bridge status. Rust rejects any close with a volume, before a command ID is
  minted, unless it was negotiated. The EA version is `1.004`.
- **Domain validation** in `crates/trading-core/src/partial_close.rs`
  (`PartialCloseLimits`, typed `PartialCloseError`). Rust validates against the
  cached portfolio position and fails closed when its limits are unknown; the
  frontend mirrors the same rules in `features/partial-close/partialCloseVolume.ts`.
- **EA**: validates fail-closed at intake (capability, positive decimal) and
  against the live position (`≤ POSITION_VOLUME`, `≥ SYMBOL_VOLUME_MIN`,
  multiple of `SYMBOL_VOLUME_STEP`, remainder `0` or `≥ SYMBOL_VOLUME_MIN`),
  calls `PositionClosePartial`, and arms the command watch with the
  **requested** volume so the partial fill completes the command.
- The journal already records `volume` in `ExecutionOperation::CloseOrder`; no
  schema change or `SCHEMA_VERSION` bump.
- A position that is still open after a partial close is not evidence that the
  close failed, and absence of a deal is not evidence that it did not execute.

## Tests

- `trading-core`: volume rule table (min, step, remainder, presets, `V < 2m`).
- Rust: capability negotiation and reset; close with a volume rejected without
  the capability or limits, accepted and journalled with them; `null`
  unchanged.
- Mock self-test: partial close reduces the position and reports
  `filled_volume`; invalid volumes are rejected.
- E2E: pure volume rules and formatter; portfolio split button, presets,
  popover validation, disabled states, menu containment in the drawer; chart
  ▾ painting, menu anchoring, right-click, ✕ blocked while the popover is
  open; EA-style 8-decimal volumes display as `0.05`.
- Still required: MetaEditor compile with 0 errors / 0 warnings, and a
  demo-account partial close on a hedging and a netting account.
