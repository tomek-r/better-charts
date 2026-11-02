/** The dashes a line can be drawn in; the names are what the settings store. */
export type LineDashKind = 'solid' | 'dashed' | 'dotted';

/** The canvas dash of a dashed line: 4 px on, 3 px off. */
export const DASHED_LINE_PATTERN: readonly number[] = [4, 3];

/** The canvas dash of a dotted line: a 1 px dot every 3 px, as the settings dialog previews it. */
export const DOTTED_LINE_PATTERN: readonly number[] = [1, 3];

/** The dash of each style in CSS px; a solid line has none. */
const DASH_PATTERNS: Readonly<Record<LineDashKind, readonly number[] | undefined>> = {
  solid: undefined,
  dashed: DASHED_LINE_PATTERN,
  dotted: DOTTED_LINE_PATTERN,
};

/** The runs a line of this style is dashed in, in CSS px; undefined while it is solid. */
export function dashPatternOf(kind: LineDashKind): readonly number[] | undefined {
  return DASH_PATTERNS[kind];
}
