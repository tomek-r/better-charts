import { isPlainRecord } from '../../../chart/engine/drawings/toolInputs';
import type { PlacedFixedRangeProfile } from '../range';

/**
 * The geometry one FRVP drawing stores: the profile window and the slot its right-hand handle ends
 * at. The engine treats it as opaque JSON, so this module is the one place that decides whether a
 * stored value is a range the tool can paint again.
 */
export type FixedRangeProfileGeometry = PlacedFixedRangeProfile;

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/**
 * A stored geometry, or undefined when it is not one: the three times must be whole milliseconds,
 * and the handles must delimit a non-empty window whose start is at or before its last slot.
 */
export function readFixedRangeProfileGeometry(value: unknown): FixedRangeProfileGeometry | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const { fromMs, endMs, lastSlotOpenMs } = value;
  if (!isFiniteInteger(fromMs) || !isFiniteInteger(endMs) || !isFiniteInteger(lastSlotOpenMs)) {
    return undefined;
  }
  if (fromMs > lastSlotOpenMs || lastSlotOpenMs >= endMs) {
    return undefined;
  }
  return { fromMs, endMs, lastSlotOpenMs };
}

/** The plain copy a record stores: no reference back into the drawing's state. */
export function fixedRangeProfileGeometry(range: PlacedFixedRangeProfile): FixedRangeProfileGeometry {
  return { fromMs: range.fromMs, endMs: range.endMs, lastSlotOpenMs: range.lastSlotOpenMs };
}
