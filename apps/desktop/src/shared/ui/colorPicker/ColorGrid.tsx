import { solidHexColor } from '../../theme/hexColor';
import { ColorSwatchButton } from './ColorSwatchButton';
import { GREYSCALE_ROW, HUE_ROW, PALETTE_COLUMNS, TINT_AND_SHADE_ROWS } from './colorPalette';

interface ColorGridProps {
  /** The colour in use; the preset with the same hue and lightness, whatever its opacity, is outlined. */
  readonly current: string;
  readonly onPick: (color: string) => void;
}

/** The preset colours: greyscale, saturated hues, then a gap and the tints and shades of those hues. */
export function ColorGrid({ current, onPick }: ColorGridProps) {
  const solidCurrent = solidHexColor(current).toLowerCase();
  const renderRow = (row: readonly string[]) =>
    row.map((color) => (
      <ColorSwatchButton key={color} color={color} selected={color === solidCurrent} onPick={onPick} />
    ));
  return (
    <div
      className="color-grid"
      role="group"
      aria-label="Preset colours"
      style={{ gridTemplateColumns: `repeat(${PALETTE_COLUMNS}, 1fr)` }}
    >
      {renderRow(GREYSCALE_ROW)}
      {renderRow(HUE_ROW)}
      <div className="color-grid-gap" aria-hidden="true" />
      {TINT_AND_SHADE_ROWS.map(renderRow)}
    </div>
  );
}
