import { LinePreview, type LineDashStyle } from './LinePreview';
import { SegmentedChoice } from './SegmentedChoice';

/** What a line adds to the picker: its thickness and dash pattern, and the values on offer for each. */
export interface LineOptions {
  readonly widths: readonly number[];
  readonly dashStyles: readonly LineDashStyle[];
  readonly width: number;
  readonly dashStyle: LineDashStyle;
  readonly onWidthChange: (width: number) => void;
  readonly onDashStyleChange: (dashStyle: LineDashStyle) => void;
}

const DASH_STYLE_LABELS: Readonly<Record<LineDashStyle, string>> = {
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
};

/** Thickness and Line style as two segmented controls, each option drawn as a sample line. */
export function LineOptionsSection({
  widths,
  dashStyles,
  width,
  dashStyle,
  onWidthChange,
  onDashStyleChange,
}: LineOptions) {
  return (
    <>
      <SegmentedChoice
        label="Thickness"
        value={width}
        onChange={onWidthChange}
        options={widths.map((option) => ({
          value: option,
          label: `${option} px`,
          preview: <LinePreview color="currentColor" width={option} dash="solid" pixelWidth={28} />,
        }))}
      />
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
