import { useEffect, useRef } from 'react';
import { solidHexColor } from '../../theme/hexColor';
import { ColorSwatchButton } from './ColorSwatchButton';

interface CustomColorsProps {
  /** The saved colours, newest first. */
  readonly colors: readonly string[];
  readonly current: string;
  readonly onPick: (color: string) => void;
  /** A colour the user just chose in the native colour input. */
  readonly onAdd: (color: string) => void;
}

/** The user's saved colours and a "+" that opens the native colour input to add one. */
export function CustomColors({ colors, current, onPick, onAdd }: CustomColorsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const solidCurrent = solidHexColor(current).toLowerCase();

  // The native `change` event, not React's `onChange` (which is `input`): a colour counts once the user commits it.
  useEffect(() => {
    const input = inputRef.current;
    if (input === null) {
      return undefined;
    }
    const commit = () => onAdd(input.value);
    input.addEventListener('change', commit);
    return () => input.removeEventListener('change', commit);
  }, [onAdd]);

  return (
    <div className="color-custom" role="group" aria-label="Custom colours">
      {colors.map((color) => (
        <ColorSwatchButton key={color} color={color} selected={color === solidCurrent} onPick={onPick} />
      ))}
      <button
        type="button"
        className="color-swatch color-add"
        aria-label="Add custom colour"
        onClick={() => inputRef.current?.click()}
      >
        +
      </button>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="color"
        aria-label="Custom colour"
        tabIndex={-1}
        defaultValue={solidCurrent}
      />
    </div>
  );
}
