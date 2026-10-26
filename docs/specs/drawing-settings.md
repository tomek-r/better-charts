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
3. `drawing-visibility`: a generic tab with MT5 timeframe ranges, stored as a new record field.
   - Minutes 1-30 (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30) and Hours 1-12 (1, 2, 3, 4, 6, 8, 12) as snapping range
     sliders.
   - Days, Weeks and Months as checkboxes.
4. `profile-request-params`: rows layout and value area percent in the Rust profile request.
5. `fixed-range-profile-settings`: the tool declares its inputs and styles.

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
