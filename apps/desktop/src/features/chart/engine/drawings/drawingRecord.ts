import { isPlainRecord, isToolInputValues, type ToolInputValues } from './toolInputs';

/**
 * A drawing as the engine carries it: its settings and the geometry its own tool wrote.
 * Only the owning tool knows what `geometry` holds, so the engine treats it as opaque JSON
 * and the tool validates it on the way back in.
 */

/** What one tool exports and imports: one of its drawings. */
export interface ChartToolDrawingRecord {
  readonly id: string;
  /** A locked drawing ignores edit gestures until it is unlocked. */
  readonly locked: boolean;
  readonly inputs: ToolInputValues;
  /** Tool-specific JSON; only the tool that wrote it knows how to read it. */
  readonly geometry: unknown;
}

/** What the app stores: one tool's drawing, stamped with the tool that owns it. */
export interface ChartDrawingRecord extends ChartToolDrawingRecord {
  readonly toolId: string;
}

/** The drawing the user picked: which tool owns it, and whether it is locked against edits. */
export interface ChartDrawingSelection {
  readonly toolId: string;
  readonly drawingId: string;
  readonly locked: boolean;
}

function isPresentString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Shape check of one stored drawing: ids, the lock flag, the settings map and the presence
 * of `geometry`. Nothing about the geometry's content is checked here.
 */
export function readChartDrawingRecord(value: unknown): ChartDrawingRecord | undefined {
  if (!isPlainRecord(value) || !('geometry' in value)) {
    return undefined;
  }
  const { id, toolId, locked, inputs, geometry } = value;
  if (!isPresentString(id) || !isPresentString(toolId)) {
    return undefined;
  }
  if (typeof locked !== 'boolean' || !isToolInputValues(inputs)) {
    return undefined;
  }
  return { id, toolId, locked, inputs, geometry };
}

/** A fresh drawing id, unique across every drawing the app has saved. */
export function newChartDrawingId(): string {
  return crypto.randomUUID();
}
