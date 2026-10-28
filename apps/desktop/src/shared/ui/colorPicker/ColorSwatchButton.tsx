interface ColorSwatchButtonProps {
  readonly color: string;
  /** Whether this swatch is the colour in use: it is outlined and reported as pressed. */
  readonly selected: boolean;
  readonly onPick: (color: string) => void;
}

/** One colour of the picker's grid or custom row, named by its hex code. */
export function ColorSwatchButton({ color, selected, onPick }: ColorSwatchButtonProps) {
  return (
    <button
      type="button"
      className="color-swatch"
      style={{ backgroundColor: color }}
      aria-label={color}
      aria-pressed={selected}
      onClick={() => onPick(color)}
    />
  );
}
