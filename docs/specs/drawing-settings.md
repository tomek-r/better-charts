# Drawing settings dialog

A TradingView-style settings dialog with the tabs Inputs, Style, Coordinates and Visibility. It is generic for
every drawing tool: a tool declares only what it has. The fixed range volume profile is the first tool with a
full set.

## Success criteria

- Any tool gets the dialog by declaring settings.
- Settings persist.
- Inputs that feed a computation re-request it; style changes only repaint.
- Changes are additive, so old saved drawings load unchanged.

## Modules

1. `settings-schema` (done): `inline` and `activeWhen` on inputs, the style schema, the tabbed dialog with the
   Inputs and Style tabs.
2. `drawing-coordinates`: a generic tab; a time anchor gets date and time fields, a price anchor a price field.
   - Times are whole minutes, MT5's lowest timeframe: the time field is `HH:MM` (60-second step), a stored anchor
     with seconds shows the nearest minute, and Ok stores whole minutes. A typed `HH:MM:SS` is tolerated and rounded
     to the nearest minute, not rejected.
   - The fixed range volume profile window is aligned in one pure helper (`minuteAlignedWindow`): each edge rounds to
     the nearest minute (30 s rounds up) and an empty window ends one minute after it starts. It runs where a window
     is placed, where a boundary is dragged, where stored points are read (so old drawings normalise) and where
     Coordinates sets points, so tick requests always cover whole M1 bars.
3. `drawing-visibility`: a generic tab with MT5 timeframe ranges, stored as a new record field.
   - Minutes 1-30 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30) and Hours 1-12 (1, 2, 3, 4, 6, 8, 12) as snapping range
     sliders.
   - Days, Weeks and Months as checkboxes.
   - Stored per drawing as `timeframeVisibility` (`minutes` and `hours` as `{ shown, from, to }` counts, plus
     `days`, `weeks`, `months` flags). A record without it shows everywhere. The tool set owns it like
     `belowBars`, stamps it on export and applies it in the paint and hit passes; the drawing keeps its own
     `visible` flag. The Rust store keeps it as JSON text in a column added by migration v3.
4. `profile-request-params`: rows layout and value area percent in the Rust profile request.
5. `fixed-range-profile-settings` (done): the tool declares its inputs and styles (`fixedRangeProfile/fixedRangeProfileSettings.ts`).
   - Inputs: Rows Layout (Number Of Rows / Ticks Per Row) (default Ticks Per Row, 1 tick; the backend coarsens a range that would need too many rows) with Row Size 1-128 or Ticks Per Row 1-100000, each on its
     own row (`activeWhen` disables the one the layout does not use; a disabled field never blocks OK or shows as invalid, and on save an
     invalid draft in it is replaced by the value the drawing already stored), Volume (Up/Down, Total, Delta), Value Area
     Volume % 1-100, Extend Right.
   - Styles: Up Volume and Down Volume colours, Values (checkbox plus colour, default off with the `text` palette
     colour; per-row volume text, see below), POC, VAH and VAL lines, Width (% of range) 1-100, Placement Left or
     Right, and last Histogram Box (a colour swatch with no checkbox; painted first, behind the bars and level lines,
     spanning the range box and the bins' price extent; the default is the `raised` palette colour at alpha 00, so
     it paints nothing until the user raises the opacity and saved drawings look unchanged). Defaults are the 1 tick per row / 70% request (a drawing that stored Number Of Rows keeps it) and the 20% width; the width is now a share of the range
     and no longer capped at 180 px, so the default look changes (the owner asked for this).
   - Rows layout, row count, ticks and value area map to the request through one pure function; a change re-requests
     the profile (a hidden drawing asks when shown again). Everything else only repaints.
   - Rendering: the histogram's widest extent is this share of the range width (handle to handle); bars are clipped
     to the pane only, with no pixel cap. Total stacks down then up, scaled
     by the largest total; Delta is one bar of |up - down| in the leading side's colour; both reach the full extent.
     Left anchors at the range start and grows right, Right anchors at the range end and grows left. Up/Down
     mirrors down left and up right of the anchor line itself (the range start for Left, the range end for
     Right), each side at most half the extent, so one side extends outside the range and a row with the maximum
     on both sides spans the extent exactly. A hidden level paints no line and reports no y; without Extend Right the lines stop at the range end.
   - Values: drawn after the bars and before the level lines, 11px system-ui, clipped to the pane only. Each
     non-empty row shows its volumes 4px beside the anchor line (see Values Position), vertically centred: Up/Down `down×up` (bid×ask, the bars' left-to-right order),
     Total `up+down`, Delta `up-down` with a typographic minus. Numbers are compact: under 1000 at most 2 decimals,
     then 3 significant digits with K, M or B (`1.35K`). Every non-empty row is labelled, with a font of its own
     height minus 1px, capped at 11px and floored at 1px, centred on the row. No mode has a totals line. Up/Down adds two `Bid×Ask`
     headers in the smallest row font: one 4px above the highest labelled row, one 4px under the lowest row. Total
     and Delta have no headers. `state.hit` reports `valueLabels` (row labels painted), `headerTopY` and `headerBottomY` (header baselines, Up/Down only), `valueLabelX` and
     `valueLabelAlign`. Toggling only repaints.
   - Values Position (`Center` default, `Left`, `Right`), a child of Values (indented, disabled while Values is off).
     Every text (rows, headers) is centred in one column as wide as the widest of them; the option only
     places the column: Right starts it 4px right of the anchor line, Left ends it 4px left of it, Center centres it
     on the line. `valueLabelX` is the column centre and `valueLabelAlign` is always `center`. `state.hit` also reports the labels column as `valuesColumnLeft/Right/Top/Bottom`
     (set whenever labels paint, even with a transparent Values Background) and the bars' vertical extent as
     `profileTop`/`profileBottom` (with `profileLeft`/`profileRight`); a press on either area selects the drawing,
     like a press in its band. Old stored
     `On Profile` / `Opposite Side` values read as the default. Changing it only repaints.
   - Values Background, a colour swatch without a checkbox and a child of Values (transparent by default, so saved
     drawings are unchanged). A visible colour paints one filled box behind the labels column, from the anchor line to
     4px past the widest text (centred: that far either side of the line), from the top of the highest label or
     header to the bottom of the lowest row or bottom header; `state.hit` reports
     it as `valuesBoxLeft/Right/Top/Bottom`. Changing it only repaints.
   - A drawing learns its resolved values through the optional `settingsChanged` member of `ChartDrawingShape`.

Templates and Developing POC/VA come later.

## Settings schema

- Inputs stay Pine Script v6 `input.*`. `ToolInputCommon` gains `inline` (inputs with the same key share one row,
  in declaration order) and `activeWhen` (`{ inputId, equals }`: the field is disabled while the other input's
  current dialog value differs; a disabled field keeps its value).
- Styles follow Pine's per-plot Style tab and are declared separately in `toolStyles.ts`. Every style has `id`,
  `title` and an optional `parentId` (indented under the parent, disabled while the parent's checkbox is off).
  Kinds: `line` (checkbox, colour, width 1-4, solid/dashed/dotted), `color` (optional checkbox), `toggle`,
  `number`, `choice`.
- Storage stays scalar (the Rust store accepts number/bool/string values, at most 64 per drawing, keys up to 64
  bytes). Each style flattens into the same values map as the inputs: `${id}.visible`, `${id}.color`,
  `${id}.width`, `${id}.style`, or plain `${id}` for number and choice.
- One resolver merges inputs and styles; invalid values fall back to the default and unknown keys are dropped. An
  id collision throws when a tool's drawings are defined.
- A tool declares `styles` next to `inputs` on `ChartToolDefinition` and `ChartDrawingRules`.

## Dialog

- An ARIA tablist; a tab exists only when it has content, and a tool with no settings keeps the "This tool has
  no settings yet." message. Arrow keys, Home and End move between tabs.
- Tabs are modelled as `{ id, title, render }` entries built from the declaration, so a later module adds a tab
  by adding an entry.
- Ok saves the merged values through `setInputs`; it stays disabled while any value is invalid.
- Top-anchored: the panel hangs from a fixed offset below the window's top edge (`backdropClassName`
  `drawing-settings-backdrop`, not the shared centring), so tabs of different height never move it. Only this dialog
  does this; the other modals keep centring.
- One setting per row in a two-column grid, label left and control right, in both the Inputs and Style tabs. Number
  fields are wide enough for four digits and their spin buttons. `inline` stays in the schema (Pine v6), but no
  tool uses it by default.
- Text is one step larger than before (15px body, 16px footer buttons), set once by the dialog's stylesheet.
- Drop-downs (Inputs options and Style choices) are `shared/ui/select/Select`, an ARIA listbox: a button with
  `aria-haspopup="listbox"` and `aria-expanded`, a portalled list with `role="option"` and `aria-selected`, a check
  mark on the chosen option. Enter, Space and the up and down arrows open it; arrows, Home, End and a typed first
  letter move; Enter or Space selects; Escape closes it and returns focus to the button; Tab and an outside press
  close it. The list opens under the button and above it when there is no room.
- Colour and line picker (`shared/ui/colorPicker`): one swatch button per `color` or `line` style opens a popover with
  a ten-column preset grid (greyscale, saturated hues, then six tint and shade rows), the current preset outlined
  (`aria-pressed`), the user's custom colours (up to ten, newest first, no repeats, kept in `localStorage` under a
  versioned key) with a "+" that adds one from the native colour input, and Opacity as a slider over a checkerboard
  gradient plus a 0-100 percent field. A `line` style adds Thickness (1-4) and Line style (solid, dashed, dotted)
  as segmented controls, and its swatch previews colour, width and style; it replaces the separate width and style
  controls. The popover traps focus, Escape closes it and returns focus to the swatch, an outside press closes it.
  Changes go to the dialog's pending values; Cancel discards them.
- Colours are stored as `#rrggbb` (opaque) or `#rrggbbaa`; a fully opaque colour is always six digits, so earlier
  values are unchanged. The Rust store keeps them as plain strings. Canvas consumers pass them straight to
  `fillStyle` or `strokeStyle`; the fixed range volume profile's own `globalAlpha` (rows 0.75, POC row 1, level
  lines 0.95) multiplies with the colour's alpha.
