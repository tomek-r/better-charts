import type { ChartDrawingPoint, ChartToolDrawingRecord } from './drawingRecord';
import type { ToolInputDefinition, ToolInputValues } from './toolInputs';

/**
 * A drawing of one tool, seen by the engine's shared drawing core: the anchors it stores and the
 * three things only its own tool can answer. Everything drawings have in common (ids, paint order,
 * selection, lock, visibility, settings, the stored records) belongs to `ChartDrawingCollection`,
 * so a tool implements this and nothing else.
 */
export interface ChartDrawingShape {
  /** The anchors the app stores, in paint order. */
  points(): ChartDrawingPoint[];
  /** Whether the pane point, in CSS px, is on this drawing. */
  contains(x: number, y: number): boolean;
  /**
   * The drawing was hidden or shown. A drawing that owns backend work starts or stops it here; the
   * state that made it hidden, and the paint order, stay with the collection.
   */
  visibilityChanged(visible: boolean): void;
  /** The drawing goes away: release everything it still holds. */
  dispose(): void;
}

/** How a tool turns stored anchors back into one of its drawings. */
export interface ChartDrawingFactory<Drawing extends ChartDrawingShape> {
  /** The drawing these anchors name, or undefined when they are not one of this tool's drawings. */
  restore(points: readonly ChartDrawingPoint[]): Drawing | undefined;
}

/** What one anchor of a drawing must carry. */
export type ChartDrawingAnchor = 'time' | 'price' | 'timePrice';

/**
 * How many anchors one drawing of a tool has, and what each of them must carry: a time, a price, or
 * both. A tool whose drawings carry no time, price or pair of them cannot be stored or restored.
 */
export interface ChartDrawingPointRule {
  readonly min: number;
  readonly max: number;
  readonly anchor: ChartDrawingAnchor;
}

/** What a tool declares about its drawings: the settings each one carries and the anchors it holds. */
export interface ChartDrawingRules {
  readonly inputs: readonly ToolInputDefinition[];
  readonly points: ChartDrawingPointRule;
}

/**
 * The drawing operations of one tool, and the only way the tool set reaches drawings: hit tests, the
 * selection, the user's edits and the records the app saves. A tool that places no drawings omits
 * the member entirely, so every operation on it is a no-op.
 */
export interface ChartToolDrawings {
  /** Id of the topmost visible drawing under the pane point, null when none is there. */
  drawingAt(x: number, y: number): string | null;
  /** Paints the highlight on the given drawing; null means none of this tool's drawings is selected. */
  select(drawingId: string | null): void;
  /** Removes one drawing; false when the tool has no drawing with that id. */
  delete(drawingId: string): boolean;
  /** A locked drawing ignores edit gestures; false when the tool has no drawing with that id. */
  setLocked(drawingId: string, locked: boolean): boolean;
  /** A hidden drawing is neither painted nor hit; false when the tool has no drawing with that id. */
  setVisible(drawingId: string, visible: boolean): boolean;
  /** Replaces one drawing's settings; false when the tool has no drawing with that id. */
  setInputs(drawingId: string, inputs: ToolInputValues): boolean;
  /** Every drawing of this tool, for the app to save. */
  exportRecords(): ChartToolDrawingRecord[];
  /**
   * Replaces every drawing of the tool. The anchors and the settings are validated against the tool's
   * rules and invalid records are dropped; nothing is reported through the host, because nothing was
   * placed.
   */
  importRecords(records: readonly ChartToolDrawingRecord[]): void;
  /** Drops every drawing, e.g. when the instrument it was drawn on went away. */
  clear(): void;
}
