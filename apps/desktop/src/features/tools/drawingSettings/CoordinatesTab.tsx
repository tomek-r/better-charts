import type { ChartDrawingAnchor } from '../../chart/engine/drawings/toolDrawings';
import { CoordinateField } from './CoordinateField';
import {
  anchorFieldNames,
  invalidCoordinateFields,
  type CoordinateFieldName,
  type CoordinateRowText,
} from './coordinateText';

/** What the Coordinates tab shows of a drawing's anchors and the one way to edit a field. */
export interface CoordinateEditing {
  readonly rows: readonly CoordinateRowText[];
  readonly onChange: (rowIndex: number, name: CoordinateFieldName, text: string) => void;
  /** The tool refused these anchors when the dialog last saved; editing a field clears it. */
  readonly rejected: boolean;
}

interface CoordinatesTabProps extends CoordinateEditing {
  readonly anchor: ChartDrawingAnchor;
}

interface CoordinateRowProps {
  readonly label: string;
  readonly anchor: ChartDrawingAnchor;
  readonly row: CoordinateRowText;
  readonly onChange: (name: CoordinateFieldName, text: string) => void;
}

/** One anchor: its label on the left and the fields its kind asks for on the right. */
function CoordinateRow({ label, anchor, row, onChange }: CoordinateRowProps) {
  const invalidNames = invalidCoordinateFields(row, anchor);
  return (
    <div className="drawing-settings-coordinate-row" role="group" aria-label={label}>
      <span className="drawing-settings-label">{label}</span>
      <div className="drawing-settings-coordinate-fields">
        {anchorFieldNames(anchor).map((name) => (
          <CoordinateField
            key={name}
            rowLabel={label}
            name={name}
            value={row[name]}
            invalid={invalidNames.includes(name)}
            onChange={(text) => onChange(name, text)}
          />
        ))}
      </div>
    </div>
  );
}

/** The Coordinates tab: one row per stored anchor, labelled `#1`, `#2`, ... in paint order. */
export function CoordinatesTab({ anchor, rows, onChange, rejected }: CoordinatesTabProps) {
  return (
    <div className="drawing-settings-coordinate-list">
      {rows.map((row, index) => {
        const label = `#${index + 1}`;
        return (
          <CoordinateRow
            key={label}
            label={label}
            anchor={anchor}
            row={row}
            onChange={(name, text) => onChange(index, name, text)}
          />
        );
      })}
      {rejected ? (
        <p className="drawing-settings-error" role="alert">
          These points don&apos;t make a valid drawing.
        </p>
      ) : null}
    </div>
  );
}
