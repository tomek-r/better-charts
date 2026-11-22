import type { IndicatorTick } from '../../../../shared/bridge/types';
import type { KeyedReadSource } from './keyedReadSource';

/** One read of the chart symbol's raw ticks, keyed so that reads in flight never mix up their answers. */
export interface IndicatorTicksQuery {
  /** 1–64 characters of `[A-Za-z0-9_:-]`: the key the host routes this read's answer by. */
  readonly key: string;
  /** The half-open range `[fromMs, toMs)` to read. */
  readonly fromMs: number;
  readonly toMs: number;
  /** The most ticks one page may carry: the page size the host negotiated. */
  readonly maxTicks: number;
}

/** What a read answers: a page of raw ticks oldest first, or that the host could not read them at all. */
export type IndicatorTicksAnswer =
  | {
      readonly kind: 'page';
      readonly fromMs: number;
      readonly toMs: number;
      /** False when the page bound truncated the range: `ticks` is then its oldest continuous prefix only. */
      readonly complete: boolean;
      readonly ticks: readonly IndicatorTick[];
    }
  | { readonly kind: 'unavailable' };

/** Raw ticks as an indicator calculated on N-tick bars reads them from its host, read-only and keyed. */
export type IndicatorTickSource = KeyedReadSource<IndicatorTicksQuery, IndicatorTicksAnswer>;
