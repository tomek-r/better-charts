import { useRef, useState } from 'react';
import { solidHexColor } from '../../theme/hexColor';
import { ColorSwatchButton } from './ColorSwatchButton';
import { CustomColorEditor } from './CustomColorEditor';

interface CustomColorsProps {
  /** The saved colours, newest first. */
  readonly colors: readonly string[];
  readonly current: string;
  readonly onPick: (color: string) => void;
  /** A colour the user just chose in the editor. */
  readonly onAdd: (color: string) => void;
}

/** The user's saved colours and a "+" that opens the in-app editor below them to add one. */
export function CustomColors({ colors, current, onPick, onAdd }: CustomColorsProps) {
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const solidCurrent = solidHexColor(current).toLowerCase();

  const closeEditor = () => {
    setEditing(false);
    addButtonRef.current?.focus();
  };

  const add = (color: string) => {
    onAdd(color);
    closeEditor();
  };

  return (
    <>
      <div className="color-custom" role="group" aria-label="Custom colours">
        {colors.map((color) => (
          <ColorSwatchButton key={color} color={color} selected={color === solidCurrent} onPick={onPick} />
        ))}
        <button
          ref={addButtonRef}
          type="button"
          className="color-swatch color-add"
          aria-label="Add custom colour"
          aria-expanded={editing}
          onClick={() => setEditing((open) => !open)}
        >
          +
        </button>
      </div>
      {editing ? <CustomColorEditor initialColor={solidCurrent} onAdd={add} onClose={closeEditor} /> : null}
    </>
  );
}
