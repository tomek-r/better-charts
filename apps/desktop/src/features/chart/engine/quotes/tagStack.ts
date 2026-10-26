/**
 * Vertical placement of the price-axis tag stack: Ask, Bid and the countdown
 * directly under the Bid.
 *
 * Both primitives paint their own box, so each used to round its own centre. A
 * fractional spacing next to a whole-pixel box height left a one pixel gap or
 * overlap between neighbours that came and went as the price moved. The tops are
 * therefore derived here, once, from whole-pixel heights: a tag that touches its
 * neighbour starts exactly where the neighbour ends.
 */

/** Height of a primitive price-axis label, per 12px of font, in whole pixels. */
export const priceTagHeight = (fontSize: number) => Math.round(fontSize * (1 + 2 * ((2.5 + 2) / 12)));

/**
 * Half the shortfall when two tags would sit closer than one tag height, so
 * each moves away by the same amount. Zero once they are far enough apart,
 * which leaves a wide spread looking exactly like the native labels.
 */
export const priceTagOffset = (gap: number, height: number) => Math.max(0, height - Math.abs(gap)) / 2;

export interface TagStackTops {
  /** Whole-pixel top of each box; NaN while its price has no coordinate. */
  ask: number;
  bid: number;
  countdown: number;
}

/**
 * Tops of the three tags from the axis coordinates of the Ask and Bid prices.
 * A tag stays on its own price unless it would overlap its neighbour; tags that
 * touch share one edge, so they are flush at any price and any pixel ratio.
 */
export function tagStackTops(askY: number | null, bidY: number | null, height: number): TagStackTops {
  const half = height / 2;
  const tops: TagStackTops = { ask: NaN, bid: NaN, countdown: NaN };
  if (bidY === null) {
    if (askY !== null) {
      tops.ask = Math.round(askY - half);
    }
    return tops;
  }
  if (askY === null) {
    tops.bid = Math.round(bidY - half);
  } else {
    const gap = bidY - askY;
    const offset = priceTagOffset(gap, height);
    tops.ask = Math.round(askY - offset - half);
    // Ask above Bid and within one tag height: the pair is restacked outwards, so
    // the Bid box starts where the Ask box ends.
    tops.bid = gap >= 0 && gap <= height ? tops.ask + height : Math.round(bidY + offset - half);
  }
  tops.countdown = tops.bid + height;
  return tops;
}
