import type { ReactNode } from 'react';
import { OutlineIcon } from '../../../../shared/ui/icons/OutlineIcon';

/* One glyph per plot type, drawn on the 24x24 grid of the shared outline icons in `currentColor`: what each
   type draws, at a glance. A type with breaks leaves the gap its plot leaves at a missing value. */

/** The values a plain line, an area and their breaks follow, rising across the glyph. */
const LINE_PATH = 'M3.5 16.5 8 10 12.5 13.5 16.5 8 20.5 12';

/** The values an area's line follows, shaded down to the glyph's baseline. */
const AREA_PATH = 'M3.5 16 8 9.5 12.5 13 16.5 7.5 20.5 11.5';

/** How an area glyph shades the space under its line. */
const AREA_SHADE = { fill: 'currentColor', opacity: '0.18', stroke: 'none' } as const;

/** Line: the values joined by one line. */
function LineGlyph() {
  return <path d={LINE_PATH} />;
}

/** Line with breaks: the line stops at a missing value and starts again after it. */
function LineBreaksGlyph() {
  return (
    <>
      <path d="M3.5 16.5 8.5 9.5" />
      <path d="M13 13 16.5 8 20.5 12" />
    </>
  );
}

/** Step line: each value held across its bar, then joined to the next. */
function StepGlyph() {
  return <path d="M3.5 17.5h5v-6h5v4h7" />;
}

/** Step line with breaks: two stepped runs, with the gap a missing value leaves between them. */
function StepBreaksGlyph() {
  return (
    <>
      <path d="M3.5 17.5h5v-6" />
      <path d="M13 13.5h3v-4h4.5" />
    </>
  );
}

/** Step line with diamonds: a stepped line, with a diamond on each value. */
function StepDiamondsGlyph() {
  return (
    <>
      <path d="M3.5 17.5h5v-6h5v4h7" />
      <path d="M13 5.5 15 7.5 13 9.5 11 7.5Z" />
    </>
  );
}

/** Histogram: one stem per value, from the baseline up to it. */
function HistogramGlyph() {
  return <path d="M6 19.5V10M12 19.5V5M18 19.5V13" />;
}

/** Cross: a cross on every value. */
function CrossGlyph() {
  return (
    <>
      <path d="M5 8v5M2.5 10.5h5" />
      <path d="M12 14v5M9.5 16.5h5" />
      <path d="M19 6v5M16.5 8.5h5" />
    </>
  );
}

/** Area: the line, with the space under it shaded. */
function AreaGlyph() {
  return (
    <>
      <path d={`${AREA_PATH}V20.5H3.5Z`} {...AREA_SHADE} />
      <path d={AREA_PATH} />
    </>
  );
}

/** Area with breaks: the shaded area stops at a missing value and starts again after it. */
function AreaBreaksGlyph() {
  return (
    <>
      <path d="M3.5 16 8 9.5V20.5H3.5Z" {...AREA_SHADE} />
      <path d="M12.5 13 16.5 7.5 20.5 11.5V20.5H12.5Z" {...AREA_SHADE} />
      <path d="M3.5 16 8 9.5" />
      <path d="M12.5 13 16.5 7.5 20.5 11.5" />
    </>
  );
}

/** Columns: one column per value, each as tall as it. */
function ColumnsGlyph() {
  return (
    <>
      <rect x="4" y="12" width="4" height="8" fill="currentColor" stroke="none" />
      <rect x="10" y="7" width="4" height="13" fill="currentColor" stroke="none" />
      <rect x="16" y="10" width="4" height="10" fill="currentColor" stroke="none" />
    </>
  );
}

/** Circles: a circle on every value. */
function CirclesGlyph() {
  return (
    <>
      <circle cx="5" cy="16" r="2" />
      <circle cx="10" cy="10" r="2" />
      <circle cx="15" cy="13" r="2" />
      <circle cx="20" cy="8" r="2" />
    </>
  );
}

/** The glyph of each plot type, keyed by the value the style stores. */
const PLOT_TYPE_GLYPHS: Readonly<Record<string, () => ReactNode>> = {
  line: LineGlyph,
  lineBreaks: LineBreaksGlyph,
  step: StepGlyph,
  stepBreaks: StepBreaksGlyph,
  stepDiamonds: StepDiamondsGlyph,
  histogram: HistogramGlyph,
  cross: CrossGlyph,
  area: AreaGlyph,
  areaBreaks: AreaBreaksGlyph,
  columns: ColumnsGlyph,
  circles: CirclesGlyph,
};

/** The glyph of one plot type, and the plain line for a stored value no glyph names. */
export function plotTypeGlyph(value: string): () => ReactNode {
  return PLOT_TYPE_GLYPHS[value] ?? LineGlyph;
}

/** The icon of one plot type. */
export function plotTypeIcon(value: string): ReactNode {
  const Glyph = plotTypeGlyph(value);
  return (
    <OutlineIcon className="drawing-settings-plot-type-icon">
      <Glyph />
    </OutlineIcon>
  );
}
