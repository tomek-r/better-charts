import type { IndicatorSeriesPage } from '../../../shared/bridge/types';
import type {
  IndicatorSeriesAnswer,
  IndicatorSeriesQuery,
  IndicatorSeriesSource,
} from '../../chart/engine/indicators/indicatorSeriesSource';
import { createKeyedReadSource, type KeyedReadRoute } from './keyedReadRoute';

const UNAVAILABLE: IndicatorSeriesAnswer = { kind: 'unavailable' };

/**
 * The bridge's series route: any timeframe the connected EA advertises, of the chart's symbol or of the one a
 * read names, which the EA answers only when the session negotiated other-symbol series.
 */
export const SERIES_ROUTE: KeyedReadRoute<IndicatorSeriesQuery, IndicatorSeriesPage, IndicatorSeriesAnswer> = {
  command: 'request_indicator_series',
  pageEvent: 'indicator-series',
  refusalEvent: 'indicator-series-unavailable',
  namedSymbol: (query) => query.symbol,
  wireArgs: (query, symbol) => ({
    key: query.key,
    symbol: query.symbol ?? symbol,
    timeframe: query.timeframe,
    bars: query.bars,
    beforeMs: query.beforeMs,
  }),
  answerOf: (page) => ({ kind: 'page', beforeMs: page.beforeMs, complete: page.complete, candles: page.candles }),
  refusal: UNAVAILABLE,
};

/**
 * The bridge's read-only series route as an indicator gets it. A refused request is an unread series, which an
 * indicator keeps its last values for rather than asking again.
 */
export function createIndicatorSeriesSource(chartSymbol: () => string | undefined): IndicatorSeriesSource {
  return createKeyedReadSource(SERIES_ROUTE, chartSymbol);
}
