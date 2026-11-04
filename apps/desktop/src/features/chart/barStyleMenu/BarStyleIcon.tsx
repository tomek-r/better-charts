import type { ReactNode } from 'react';
import type { BarStyle } from '../engine/barStyle/barStyles';

/* Every glyph is drawn on a 28x28 grid in `currentColor` with a 1px stroke, on half-pixel coordinates so the
   strokes land on whole pixels. They follow TradingView's own icons: what each bar type draws, at a glance. */

/** The closes a line, an area and a baseline drawing follow, drawn across the glyph. */
const CLOSES_PATH = 'M4.5 19.5 9.5 12.5 14.5 16.5 19.5 7.5 24.5 12.5';

/** The closes a baseline drawing follows, swinging around the base level it is shaded against. */
const BASELINE_PATH = 'M4.5 20.5 9.5 10.5 14.5 18.5 19.5 8.5 24.5 15.5';

/** Bars: each bar's high-low line, with its open and close as the left and right ticks. */
function BarsGlyph() {
  return (
    <>
      <path d="M9.5 5.5v17M5.5 10.5h4M9.5 18.5h4" />
      <path d="M19.5 4.5v17M15.5 16.5h4M19.5 9.5h4" />
    </>
  );
}

/** Candles: a wick with a filled body around the open and the close. */
function CandlesGlyph() {
  return (
    <>
      <path d="M9.5 4.5v18M19.5 6.5v16" />
      <rect x="6.5" y="9.5" width="6" height="8" fill="currentColor" />
      <rect x="16.5" y="12.5" width="6" height="7" fill="currentColor" />
    </>
  );
}

/** Hollow candles: the candles' wicks and bodies, with the bodies left open. */
function HollowCandlesGlyph() {
  return (
    <>
      <path d="M9.5 4.5v18M19.5 6.5v16" />
      <rect x="6.5" y="9.5" width="6" height="8" />
      <rect x="16.5" y="12.5" width="6" height="7" />
    </>
  );
}

/** Volume candles: bodies of different widths, as the volume gives each of them its own. */
function VolumeCandlesGlyph() {
  return (
    <>
      <path d="M6 9.5v12M13 6.5v15M22 10.5v11" />
      <rect x="4.5" y="12.5" width="3" height="6" fill="currentColor" />
      <rect x="10.5" y="8.5" width="5" height="10" fill="currentColor" />
      <rect x="18.5" y="13.5" width="7" height="8" fill="currentColor" />
    </>
  );
}

/** Line: the closes joined by one line. */
function LineGlyph() {
  return <path d={CLOSES_PATH} />;
}

/** Line with markers: the line, with a dot on each close it joins. */
function LineWithMarkersGlyph() {
  return (
    <>
      <path d={CLOSES_PATH} />
      <circle cx="9.5" cy="12.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="16.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19.5" cy="7.5" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="24.5" cy="12.5" r="1.5" fill="currentColor" stroke="none" />
    </>
  );
}

/** Step line: the closes joined the way a step chart joins them, across and then down. */
function StepLineGlyph() {
  return <path d="M4.5 19.5h5v-7h5v4h5v-8h5" />;
}

/** Area: the line, with the space under it shaded. */
function AreaGlyph() {
  return (
    <>
      <path d={`${CLOSES_PATH}V23.5H4.5Z`} fill="currentColor" opacity="0.18" stroke="none" />
      <path d={CLOSES_PATH} />
    </>
  );
}

/** Baseline: a line shaded against the dashed base level it crosses. */
function BaselineGlyph() {
  return (
    <>
      <path d="M3.5 14.5h21" strokeDasharray="2 2" />
      <path d={`${BASELINE_PATH}V14.5H4.5Z`} fill="currentColor" opacity="0.18" stroke="none" />
      <path d={BASELINE_PATH} />
    </>
  );
}

/** Columns: one column per period, each as tall as its value. */
function ColumnsGlyph() {
  return (
    <>
      <rect x="4.5" y="13.5" width="4" height="10" fill="currentColor" />
      <rect x="11.5" y="8.5" width="4" height="15" fill="currentColor" />
      <rect x="18.5" y="11.5" width="4" height="12" fill="currentColor" />
    </>
  );
}

/** High-low: boxes for the periods, each with the small labels the style writes beside it. */
function HighLowGlyph() {
  return (
    <>
      <rect x="4.5" y="7.5" width="9" height="5" />
      <path d="M17.5 9h3.5M17.5 11h2.5" />
      <rect x="4.5" y="16.5" width="9" height="5" />
      <path d="M17.5 18h3.5M17.5 20h2.5" />
    </>
  );
}

/** Heikin Ashi: a run of candles whose bodies run on smoothly from one period to the next. */
function HeikinAshiGlyph() {
  return (
    <>
      <path d="M8 6.5v13M15 5.5v14M22 4.5v15" />
      <rect x="5.5" y="10.5" width="5" height="6" fill="currentColor" />
      <rect x="12.5" y="9.5" width="5" height="7" fill="currentColor" />
      <rect x="19.5" y="7.5" width="5" height="8" fill="currentColor" />
    </>
  );
}

/** What each bar type draws, keyed by the style it stands for: a style without a drawing does not compile. */
const BAR_STYLE_GLYPHS: Readonly<Record<BarStyle, () => ReactNode>> = {
  bars: BarsGlyph,
  candles: CandlesGlyph,
  hollowCandles: HollowCandlesGlyph,
  volumeCandles: VolumeCandlesGlyph,
  line: LineGlyph,
  lineWithMarkers: LineWithMarkersGlyph,
  stepLine: StepLineGlyph,
  area: AreaGlyph,
  baseline: BaselineGlyph,
  columns: ColumnsGlyph,
  highLow: HighLowGlyph,
  heikinAshi: HeikinAshiGlyph,
};

/** The icon of one bar type: the shape it draws, in the colour of the button or row that shows it. */
export function BarStyleIcon({ style }: { style: BarStyle }) {
  const Glyph = BAR_STYLE_GLYPHS[style];
  return (
    <svg
      aria-hidden="true"
      className="bar-style-icon"
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Glyph />
    </svg>
  );
}
