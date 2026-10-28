import { useState } from 'react';
import type { ChartDrawingPoint } from '../../../chart/engine/drawings/drawingRecord';
import type { ChartDrawingPointRule } from '../../../chart/engine/drawings/toolDrawings';
import type { CoordinateEditing } from './CoordinatesTab';
import {
  invalidCoordinateFields,
  pointToRowText,
  rowTextToPoint,
  sameRowTexts,
  type CoordinateRowText,
} from './coordinateText';

/** The anchors being edited in the dialog: the rows, whether each reads as a point, and what Ok would save. */
export interface CoordinateDraft extends CoordinateEditing {
  /** Whether every field of every row passes its own rule; always true for a tool with no anchors. */
  readonly valid: boolean;
  /** The edited anchors, or undefined while they read as the stored ones or are not yet valid. */
  changedPoints: () => ChartDrawingPoint[] | undefined;
  /** Shows that the tool refused the saved anchors, until the next edit. */
  reject: () => void;
}

const NO_ROWS: readonly CoordinateRowText[] = [];

/** Every anchor as a point, or undefined when one row does not name a point. */
function allPoints(rows: readonly CoordinateRowText[], rule: ChartDrawingPointRule): ChartDrawingPoint[] | undefined {
  const points: ChartDrawingPoint[] = [];
  for (const row of rows) {
    const point = rowTextToPoint(row, rule.anchor);
    if (point === undefined) {
      return undefined;
    }
    points.push(point);
  }
  return points;
}

/**
 * The editable text of a drawing's anchors, read once when the dialog opens. A tool that declares no
 * anchor rule has no rows and nothing to save.
 */
export function useCoordinateDraft(
  storedPoints: readonly ChartDrawingPoint[],
  rule: ChartDrawingPointRule | undefined,
): CoordinateDraft {
  const [storedRows] = useState(() => (rule === undefined ? NO_ROWS : storedPoints.map(pointToRowText)));
  const [rows, setRows] = useState(storedRows);
  const [rejected, setRejected] = useState(false);

  const onChange: CoordinateEditing['onChange'] = (rowIndex, name, text) => {
    setRows((current) => current.map((row, index) => (index === rowIndex ? { ...row, [name]: text } : row)));
    setRejected(false);
  };
  const reject = () => setRejected(true);

  if (rule === undefined) {
    return { rows, onChange, rejected, reject, valid: true, changedPoints: () => undefined };
  }
  return {
    rows,
    onChange,
    rejected,
    reject,
    valid: rows.every((row) => invalidCoordinateFields(row, rule.anchor).length === 0),
    changedPoints: () => (sameRowTexts(rows, storedRows) ? undefined : allPoints(rows, rule)),
  };
}
