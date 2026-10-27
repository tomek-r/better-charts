/** The dash patterns a line may have; the names are what a stored line style holds. */
export type LineDashStyle = 'solid' | 'dashed' | 'dotted';

/** SVG dash pattern of each line style in a preview, in px; a solid line has none. */
const PREVIEW_DASH: Readonly<Record<LineDashStyle, string | undefined>> = {
  solid: undefined,
  dashed: '6 4',
  dotted: '1 3',
};
const MARGIN_PX = 2;

interface LinePreviewProps {
  readonly color: string;
  readonly width: number;
  readonly dash: LineDashStyle;
  readonly pixelWidth?: number;
}

/** A short sample of a line, drawn the way the chart will draw it. */
export function LinePreview({ color, width, dash, pixelWidth = 36 }: LinePreviewProps) {
  const height = 12;
  const middle = height / 2;
  return (
    <svg className="line-preview" width={pixelWidth} height={height} aria-hidden="true">
      <line
        x1={MARGIN_PX}
        x2={pixelWidth - MARGIN_PX}
        y1={middle}
        y2={middle}
        stroke={color}
        strokeWidth={width}
        strokeDasharray={PREVIEW_DASH[dash]}
      />
    </svg>
  );
}
