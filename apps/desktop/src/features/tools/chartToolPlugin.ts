import type { ReactNode } from 'react';
import type { ChartToolDefinition } from '../chart/engine/tools/toolContract';

/** One glyph plus the stroke settings it is drawn with (they differ per icon). */
export interface ChartToolIconSpec {
  node: ReactNode;
  viewBox?: string;
  strokeWidth?: number;
  linecap?: 'butt' | 'round';
  linejoin?: 'miter' | 'round';
}

/**
 * A chart tool as the app lists it: the engine's behavior (`ChartToolDefinition`) plus how
 * the tool rail presents it. The engine never sees the presentation part.
 */
export type ChartToolPlugin<Id extends string = string> = ChartToolDefinition & {
  readonly id: Id;
  /** The rail button's aria-label and title. */
  readonly label: string;
  readonly icon: ChartToolIconSpec;
  /**
   * Plugins sharing a group id render as one rail button whose flyout lists them in
   * registry order; `label` names the group. Plugins without one get a direct button.
   */
  readonly railGroup?: { id: string; label: string };
};
