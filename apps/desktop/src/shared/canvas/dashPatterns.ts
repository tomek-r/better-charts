/** The dashes a line can be drawn in; the names are what the settings store. */
export type LineDashKind = 'solid' | 'dashed' | 'dotted';

/** The canvas dash of the interface's own dashed strokes (loader, selection handles): 4 px on, 3 px off. */
export const DASHED_LINE_PATTERN: readonly number[] = [4, 3];

/** The canvas dash of a line styled "dashed": 6 px on, 6 px off, as the library draws a 1 px large dash. */
export const STYLED_DASHED_LINE_PATTERN: readonly number[] = [6, 6];

/**
 * The canvas dash of a line styled "dotted": a 1 px dot every 5 px, as the chart library's sparse dots
 * draw a 1 px line.
 */
export const STYLED_DOTTED_LINE_PATTERN: readonly number[] = [1, 4];

/** The dash of each style in CSS px; a solid line has none. */
const DASH_PATTERNS: Readonly<Record<LineDashKind, readonly number[] | undefined>> = {
  solid: undefined,
  dashed: STYLED_DASHED_LINE_PATTERN,
  dotted: STYLED_DOTTED_LINE_PATTERN,
};

/** The runs a line of this style is dashed in, in CSS px; undefined while it is solid. */
export function dashPatternOf(kind: LineDashKind): readonly number[] | undefined {
  return DASH_PATTERNS[kind];
}
