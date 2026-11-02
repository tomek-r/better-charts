import { palette } from '../../../../shared/theme/palette';
import { DEFAULT_CHART_TIME_LABELS, type ChartTimeLabels } from '../../timeZone/chartTimeFormat';

/** What the Scale modes setting does with the A/L row: reveal it on hover, keep it on screen, or hide it. */
export const SCALE_BUTTON_MODES = ['mouseOver', 'always', 'hidden'] as const;

export type ScaleButtonsMode = (typeof SCALE_BUTTON_MODES)[number];

/** What the Bid/Ask setting draws of the quote: both the line and the label, one of them, or nothing. */
export const BID_ASK_DRAWING_MODES = ['lineAndLabel', 'line', 'label', 'hidden'] as const;

export type BidAskDrawingMode = (typeof BID_ASK_DRAWING_MODES)[number];

/** The Bid/Ask drawing the price axis offers, and each side's colour. */
export interface ChartBidAskAppearance {
  readonly mode: BidAskDrawingMode;
  readonly bid: string;
  readonly ask: string;
}

/** What the Scales and lines tab decides, as the chart draws it. */
export interface ChartScalesAppearance {
  readonly scaleModeButtons: ScaleButtonsMode;
  readonly countdown: boolean;
  readonly bidAsk: ChartBidAskAppearance;
  readonly timeLabels: ChartTimeLabels;
}

/**
 * The scales and lines the chart has always drawn: the A/L row revealed on hover, the countdown
 * tag, both quote drawings on, and the labels writing `Wed 30 Sep '26  08:03`.
 */
export const DEFAULT_CHART_SCALES_APPEARANCE: ChartScalesAppearance = {
  scaleModeButtons: 'mouseOver',
  countdown: true,
  bidAsk: { mode: 'lineAndLabel', bid: palette.sell, ask: palette.buy },
  timeLabels: DEFAULT_CHART_TIME_LABELS,
};

/** Whether the price axis draws the quote's line: both drawings the line mode keeps it. */
export function drawsBidAskLines(mode: BidAskDrawingMode): boolean {
  return mode === 'lineAndLabel' || mode === 'line';
}

/** Whether the price axis draws the quote's tag: both drawings the label mode keeps it. */
export function drawsBidAskLabels(mode: BidAskDrawingMode): boolean {
  return mode === 'lineAndLabel' || mode === 'label';
}

/** Whether two Bid/Ask drawings would paint the same lines and tags. */
export function sameBidAskAppearance(first: ChartBidAskAppearance, second: ChartBidAskAppearance): boolean {
  return first.mode === second.mode && first.bid === second.bid && first.ask === second.ask;
}

/** What the chart draws of the quote right now, as the dev test hook reports it. */
export interface BidAskDrawingState {
  readonly linesVisible: boolean;
  readonly labelsVisible: boolean;
  readonly bid: string;
  readonly ask: string;
}

/** The Scales and lines settings as the chart currently draws them, as the dev test hook reports them. */
export interface ChartScalesState {
  readonly scaleModeButtons: ScaleButtonsMode;
  readonly countdownVisible: boolean;
  readonly bidAsk: BidAskDrawingState;
  readonly timeLabels: ChartTimeLabels;
}
