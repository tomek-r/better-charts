import { drawsBidAskLabels, drawsBidAskLines, type BidAskDrawingMode } from '../engine/surface/chartScalesAppearance';

/** What the price axis draws of the quote: its two lines, its tag, both, or neither. */
export interface BidAskDrawings {
  readonly lines: boolean;
  readonly labels: boolean;
}

/**
 * The two drawings the price axis holds of the quote. The scales settings store one mode, which holds both
 * of them, so a menu row that changes one of the two keeps the other exactly as it was.
 */
export function bidAskDrawingsOf(mode: BidAskDrawingMode): BidAskDrawings {
  return { lines: drawsBidAskLines(mode), labels: drawsBidAskLabels(mode) };
}

/** The mode that draws exactly these lines and labels, which is how a flipped row is saved. */
export function bidAskDrawingModeOf({ lines, labels }: BidAskDrawings): BidAskDrawingMode {
  if (lines) {
    return labels ? 'lineAndLabel' : 'line';
  }
  return labels ? 'label' : 'hidden';
}
