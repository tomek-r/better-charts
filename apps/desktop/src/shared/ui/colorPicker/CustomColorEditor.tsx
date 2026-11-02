import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { hexToHsv, hsvToHex, readHexInput, type HsvColor } from '../../theme/colorSpace';
import { HueBar } from './customColorEditor/HueBar';
import { SaturationValueSquare } from './customColorEditor/SaturationValueSquare';

/** Black, where the editor starts when it is handed text that is no colour. */
const BLACK_HSV: HsvColor = { hue: 0, saturation: 0, value: 0 };

interface CustomColorEditorProps {
  /** The colour the editor opens on, the picker's current one. */
  readonly initialColor: string;
  /** The colour the user settled on with Add; never called for a hex text that is no colour. */
  readonly onAdd: (color: string) => void;
  readonly onClose: () => void;
}

/**
 * The in-app colour editor that replaces the native colour panel: a preview, a hex field and Add above a
 * saturation and brightness square and a hue bar. Only Add hands a colour on, so dragging the handles
 * previews shades without storing any of them.
 */
export function CustomColorEditor({ initialColor, onAdd, onClose }: CustomColorEditorProps) {
  const fieldRef = useRef<HTMLInputElement>(null);
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(initialColor) ?? BLACK_HSV);
  // What the user is typing, which may be no colour yet; undefined shows the colour of the handles instead.
  const [typedText, setTypedText] = useState<string | undefined>(undefined);
  const hex = hsvToHex(hsv.hue, hsv.saturation, hsv.value);
  const invalid = typedText !== undefined && readHexInput(typedText) === undefined;

  // The field takes the focus, so the colour can be typed straight away and Escape reaches this editor.
  useEffect(() => {
    const field = fieldRef.current;
    if (field !== null) {
      field.focus();
      field.select();
    }
  }, []);

  const pickHue = (hue: number) => {
    setTypedText(undefined);
    setHsv((current) => ({ ...current, hue }));
  };

  const pickSaturationAndValue = (saturation: number, value: number) => {
    setTypedText(undefined);
    setHsv((current) => ({ ...current, saturation, value }));
  };

  const typeHex = (text: string) => {
    setTypedText(text);
    const typedHsv = hexToHsv(text, hsv.hue);
    if (typedHsv !== undefined) {
      setHsv(typedHsv);
    }
  };

  const add = () => {
    if (!invalid) {
      onAdd(hex);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Escape belongs to the editor while it is open: it must not also close the popover around it.
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="color-editor" onKeyDown={handleKeyDown}>
      <div className="color-editor-row">
        <span className="color-editor-preview" style={{ backgroundColor: hex }} aria-hidden="true" />
        <input
          ref={fieldRef}
          className="color-editor-hex"
          aria-label="Hex colour"
          aria-invalid={invalid}
          spellCheck={false}
          autoComplete="off"
          value={typedText ?? hex}
          onChange={(event) => typeHex(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="color-editor-add" disabled={invalid} onClick={add}>
          Add
        </button>
      </div>
      <div className="color-editor-body">
        <SaturationValueSquare
          hue={hsv.hue}
          saturation={hsv.saturation}
          value={hsv.value}
          onChange={pickSaturationAndValue}
        />
        <HueBar hue={hsv.hue} onChange={pickHue} />
      </div>
    </div>
  );
}
