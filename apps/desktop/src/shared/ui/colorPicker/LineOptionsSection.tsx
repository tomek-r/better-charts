import { LinePreview, type LineDashStyle } from './LinePreview';
import { SegmentedChoice } from './SegmentedChoice';

/** The width a line is drawn with and the widths on offer; only a line whose thickness can be set carries it. */
export interface LineThickness {
  readonly width: number;
  readonly widths: readonly number[];
  readonly onWidthChange: (width: number) => void;
}

/** What a line adds to the picker: its dash pattern, and its thickness when the line has one to set. */
export interface LineOptions {
  readonly dashStyles: readonly LineDashStyle[];
  readonly dashStyle: LineDashStyle;
  readonly onDashStyleChange: (dashStyle: LineDashStyle) => void;
  readonly thickness?: LineThickness;
}

const DASH_STYLE_LABELS: Readonly<Record<LineDashStyle, string>> = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
};

/** Thickness, when the line has one to set, and Line style as two segmented controls of sample lines. */
export function LineOptionsSection({ dashStyles, dashStyle, onDashStyleChange, thickness }: LineOptions) {
  return (
    <>
      {thickness ? (
        <SegmentedChoice
          label="Thickness"
          value={thickness.width}
          onChange={thickness.onWidthChange}
          options={thickness.widths.map((option) => ({
            value: option,
            label: `${option} px`,
            preview: <LinePreview color="currentColor" width={option} dash="solid" pixelWidth={28} />,
          }))}
        />
      ) : null}
      <SegmentedChoice
        label="Line style"
        value={dashStyle}
        onChange={onDashStyleChange}
        options={dashStyles.map((option) => ({
          value: option,
          label: DASH_STYLE_LABELS[option],
          preview: <LinePreview color="currentColor" width={2} dash={option} pixelWidth={28} />,
        }))}
      />
    </>
  );
}
