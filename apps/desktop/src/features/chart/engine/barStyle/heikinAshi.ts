import type { RenderBar } from '../bars/renderBar';

/** A time before every bar, so the first bar of an empty chain always extends it. */
const BEFORE_ANY_BAR = -Infinity;

/**
 * One Heikin Ashi bar, chained on the Heikin Ashi bar before it: the close averages the four prices, the
 * open is the middle of the two closes before it — its own open and close for the first bar — and the
 * range spans them. `previousHa` is a Heikin Ashi bar, never the raw one, because the chain compounds.
 */
export function nextHeikinAshiBar(bar: RenderBar, previousHa: RenderBar | undefined): RenderBar {
  const close = (bar.open + bar.high + bar.low + bar.close) / 4;
  const open = previousHa === undefined ? (bar.open + bar.close) / 2 : (previousHa.open + previousHa.close) / 2;
  return { ...bar, open, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close), close };
}

/** The Heikin Ashi bars of `bars`, built front to back so each one chains on the ones already written. */
export function heikinAshiBars(bars: readonly RenderBar[]): RenderBar[] {
  const heikinAshi: RenderBar[] = [];
  for (const bar of bars) {
    heikinAshi.push(nextHeikinAshiBar(bar, heikinAshi[heikinAshi.length - 1]));
  }
  return heikinAshi;
}

/**
 * The Heikin Ashi bars written so far, kept between writes because each bar chains on the Heikin Ashi bar
 * before it: a live bar that replaces the last one still chains on the bar before that.
 */
export class HeikinAshiChain {
  private chain: RenderBar[] = [];

  /** The Heikin Ashi bars of a replaced window of bars, which every write that follows chains on. */
  rebuild(bars: readonly RenderBar[]): readonly RenderBar[] {
    this.chain = heikinAshiBars(bars);
    return this.chain;
  }

  /**
   * The Heikin Ashi bar of one live update with the Heikin Ashi bar before it: a bar past the chain's
   * last one extends the chain, any other replaces the last, so a tick never falls back to a raw bar.
   */
  advance(bar: RenderBar): { bar: RenderBar; previous: RenderBar | undefined } {
    const chain = this.chain;
    const lastIndex = chain.length - 1;
    const extendsChain = bar.time > (chain[lastIndex]?.time ?? BEFORE_ANY_BAR);
    const previous = extendsChain ? chain[lastIndex] : chain[lastIndex - 1];
    const heikinAshiBar = nextHeikinAshiBar(bar, previous);
    if (extendsChain) {
      chain.push(heikinAshiBar);
    } else {
      chain[lastIndex] = heikinAshiBar;
    }
    return { bar: heikinAshiBar, previous };
  }
}
