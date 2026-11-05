/** The dash patterns a line may have; the names are what a stored line style holds. */
export type LineDashStyle = 'solid' | 'dashed' | 'dotted';

/**
 * SVG dash pattern of each line style in a preview, in px: the chart's dots, and its dashes at half
 * length so a short sample shows several; a solid line has none.
 */
const PREVIEW_DASH: Readonly<Record<LineDashStyle, string | undefined>> = {
  solid: undefined,
  dashed: '3 3',
  dotted: '1 4',
};
const MARGIN_PX = 2;

interface LinePreviewProps {
  readonly color: string;
  readonly width: number;
  readonly dash: LineDashStyle;
  readonly pixelWidth?: number;
}

/** A short sample of a line in its colour, width and style. */
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
