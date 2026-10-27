import { useId, useState, type CSSProperties } from 'react';
import { colorOpacityPercent, solidHexColor, withOpacityPercent } from '../../theme/hexColor';

const MAX_PERCENT = 100;

interface OpacityControlProps {
  readonly color: string;
  /** Called with the colour at its new opacity: six digits at 100%, eight below. */
  readonly onChange: (color: string) => void;
}

/** The opacity as a slider over a checkerboard-and-gradient track, and as a percent field kept in step with it. */
export function OpacityControl({ color, onChange }: OpacityControlProps) {
  const titleId = useId();
  const percent = colorOpacityPercent(color);
  // What the user is typing, which may be empty or out of range until they leave the field.
  const [typedText, setTypedText] = useState<string | undefined>(undefined);
  const trackStyle = { '--opacity-color': solidHexColor(color) } as CSSProperties;

  const applyPercent = (next: number) => onChange(withOpacityPercent(color, next));
  const type = (text: string) => {
    setTypedText(text);
    const typed = Number(text);
    if (text.trim() !== '' && Number.isFinite(typed)) {
      applyPercent(Math.min(MAX_PERCENT, Math.max(0, Math.round(typed))));
    }
  };

  return (
    <div className="color-opacity">
      <span id={titleId} className="color-section-title">
        Opacity
      </span>
      <input
        className="color-opacity-slider"
        style={trackStyle}
        type="range"
        min={0}
        max={MAX_PERCENT}
        step={1}
        value={percent}
        aria-labelledby={titleId}
        onChange={(event) => {
          setTypedText(undefined);
          applyPercent(Number(event.target.value));
        }}
      />
      <input
        className="color-opacity-percent"
        type="number"
        min={0}
        max={MAX_PERCENT}
        step={1}
        aria-label="Opacity percent"
        value={typedText ?? String(percent)}
        onChange={(event) => type(event.target.value)}
        onBlur={() => setTypedText(undefined)}
      />
      <span aria-hidden="true">%</span>
    </div>
  );
}
