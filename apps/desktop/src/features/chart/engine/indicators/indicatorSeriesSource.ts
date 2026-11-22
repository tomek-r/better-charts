import type { Candle } from '../../../../shared/bridge/types';
import type { KeyedReadSource } from './keyedReadSource';

/** One read of another timeframe's candles, keyed so that reads in flight never mix up their answers. */
export interface IndicatorSeriesQuery {
  /** 1–64 characters of `[A-Za-z0-9_:-]`: the key the host routes this read's answer by. */
  readonly key: string;
  readonly timeframe: string;
  /** The candles to ask for, one history page's worth at most. */
  readonly bars: number;
  /** The candles strictly older than this epoch-millisecond anchor; null asks for the newest candles. */
  readonly beforeMs: number | null;
}

/** What a read answers: a page of candles oldest first, or that the host could not read the series at all. */
export type IndicatorSeriesAnswer =
  | {
      readonly kind: 'page';
      /** Echo of the query's anchor; null for the newest candles. */
      readonly beforeMs: number | null;
      /** False when fewer candles were available older than the anchor than were asked for. */
      readonly complete: boolean;
      readonly candles: readonly Candle[];
    }
  | { readonly kind: 'unavailable' };

/** Another timeframe's candles as an indicator reads them from its host, read-only and keyed like every route. */
export type IndicatorSeriesSource = KeyedReadSource<IndicatorSeriesQuery, IndicatorSeriesAnswer>;
